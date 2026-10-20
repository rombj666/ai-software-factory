import { DrizzleQueryError } from "drizzle-orm/errors";

function chain(error: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  while (error && typeof error === "object" && result.length < 8) {
    if (result.includes(error as Record<string, unknown>)) break;
    result.push(error as Record<string, unknown>);
    error = (error as { cause?: unknown }).cause;
  }
  return result;
}

export function isDatabaseError(error: unknown): boolean {
  return chain(error).some((item) => item instanceof DrizzleQueryError ||
    (typeof item.code === "string" && /^[0-9A-Z]{5}$/.test(item.code)));
}

// Retry only errors likely to recover without a code/schema/configuration change.
const transientCodes = new Set([
  "40001", "40P01", "53300", "57P01", "57P02", "57P03", "58030",
  "08000", "08001", "08003", "08006", "08007",
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN",
  "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT",
]);

export function isPermanentError(error: unknown): boolean {
  const codes = chain(error).map((item) => item.code).filter((code): code is string => typeof code === "string");
  return codes.some((code) => !transientCodes.has(code));
}

export function safeError(error: unknown, databaseUrl: string): Record<string, unknown> {
  const secrets = [databaseUrl];
  try {
    const url = new URL(databaseUrl);
    secrets.push(url.username, url.password, decodeURIComponent(url.username), decodeURIComponent(url.password));
    for (const value of url.searchParams.values()) secrets.push(value);
  } catch { /* A malformed URL must never break error reporting. */ }
  const redact = (value: string) => {
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      value = value.split(secret).join("[redacted]");
    }
    return value
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[redacted URL]")
      .replace(/\b(password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
      .replace(/'([^']|'')*'/g, "'[redacted]'")
      .slice(0, 1000);
  };
  const causes = chain(error).map((item) => ({
    name: typeof item.name === "string" ? redact(item.name) : "Error",
    code: typeof item.code === "string" ? redact(item.code) : undefined,
    // Drizzle's wrapper message embeds SQL and parameter values. Never log it.
    message: item instanceof DrizzleQueryError ? "Database query failed" :
      typeof item.message === "string" ? redact(item.message) : "Unknown error",
  }));
  return causes[0] ? { ...causes[0], causes: causes.slice(1) } : { message: "Unknown error" };
}
