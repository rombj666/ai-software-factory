import { describe, expect, it, vi } from "vitest";
import { estimatedUsd, loadPricing } from "../src/pricing";
import { OpenAIProvider, ProviderError } from "../src/provider";
import { validatePlannerResponse } from "../src/schema";
import { plannerRequest } from "../src/planner";
import { ready, summary } from "./fixtures";

describe("Planner validation and context", () => {
  it("requires a complete summary without unanswered questions to finish", () => {
    expect(validatePlannerResponse(ready)).toEqual(ready);
    expect(() =>
      validatePlannerResponse({ ...ready, summary: null }),
    ).toThrow();
    expect(() =>
      validatePlannerResponse({ ...ready, questions: ["Who is it for?"] }),
    ).toThrow();
    expect(() =>
      validatePlannerResponse({
        ...ready,
        summary: { ...summary, openQuestions: ["Unknown users"] },
      }),
    ).toThrow();
    expect(() =>
      validatePlannerResponse({
        ...ready,
        summary: { ...summary, requiredFunctionality: [] },
      }),
    ).toThrow();
    expect(() =>
      validatePlannerResponse({ ...ready, unexpected: "injection" }),
    ).toThrow();
  });
  it("includes prior answers, corrections and technology preferences without filtering ideas", () => {
    const request = plannerRequest(
      "Desktop tool",
      "Use Python",
      [{ role: "user", content: "Correction: five users, not ten" }],
      summary,
    );
    expect(request.instructions).toContain("do not repeat answered questions");
    expect(
      request.messages.map((message) => message.content).join("\n"),
    ).toContain("Correction: five users, not ten");
    expect(request.messages.at(-1)?.content).toContain("Python desktop");
  });
});
describe("verified estimated pricing", () => {
  it("uses reported cached tokens and rounds up rather than understating cost", () => {
    const pricing = loadPricing("gpt-4.1-mini-2025-04-14", {});
    expect(
      estimatedUsd(
        { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 100 },
        pricing,
      ),
    ).toBe(0.00041);
    expect(
      estimatedUsd(
        { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 },
        pricing,
      ),
    ).toBe(0.000001);
  });
  it("fails closed for unknown models and incomplete or invalid price overrides", () => {
    expect(() => loadPricing("unknown-model", {})).toThrow();
    expect(() =>
      loadPricing("gpt-4.1-mini", { OPENAI_INPUT_USD_PER_MILLION: "0.4" }),
    ).toThrow();
    expect(() =>
      loadPricing("custom", {
        OPENAI_INPUT_USD_PER_MILLION: "-1",
        OPENAI_CACHED_INPUT_USD_PER_MILLION: "0",
        OPENAI_OUTPUT_USD_PER_MILLION: "1",
        OPENAI_PRICING_SOURCE: "verified",
      }),
    ).toThrow();
    expect(() =>
      estimatedUsd(
        { inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 },
        loadPricing("gpt-4.1-mini", {}),
      ),
    ).toThrow();
  });
});

describe("official SDK transport (mocked HTTP, no real API calls)", () => {
  const request = plannerRequest("Club", "Book club", [], null);
  function response(value: unknown, overrides = {}) {
    return {
      id: "resp_test",
      object: "response",
      created_at: 1,
      model: "gpt-4.1-mini-2025-04-14",
      status: "completed",
      output: [
        {
          type: "message",
          id: "msg_test",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              annotations: [],
              text: JSON.stringify(value),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      ...overrides,
    };
  }
  it("sends strict structured output, a token cap and store=false, and retains real response usage", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(response(ready)), {
          headers: { "content-type": "application/json" },
        }),
      );
    const provider = new OpenAIProvider(
      "test-key",
      "gpt-4.1-mini-2025-04-14",
      2500,
      1000,
      transport,
    );
    const result = await provider.consult(request);
    expect(result).toMatchObject({
      value: ready,
      usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
      outcome: "completed",
    });
    const payload = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    expect(payload).toMatchObject({
      store: false,
      max_output_tokens: 2500,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(provider.inputTokenBound(request)).toBeGreaterThan(4096);
  });
  it("never retries rate limits inside the SDK", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "secret-provider-message",
                type: "rate_limit_error",
              },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      );
    const provider = new OpenAIProvider(
      "test-key",
      undefined,
      undefined,
      1000,
      transport,
    );
    await expect(provider.consult(request)).rejects.toMatchObject({
      retryable: true,
      uncertain: false,
    });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("treats timeouts as uncertain and avoids exposing upstream error text", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("api-key-secret"));
    const provider = new OpenAIProvider(
      "test-key",
      undefined,
      undefined,
      1000,
      transport,
    );
    await expect(provider.consult(request)).rejects.toMatchObject({
      uncertain: true,
      retryable: false,
    });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("preserves usage for malformed, refused and incomplete billed output", async () => {
    for (const body of [
      response(null, { status: "incomplete" }),
      response(null, {
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Cannot help" }],
          },
        ],
      }),
    ]) {
      const provider = new OpenAIProvider(
        "test-key",
        undefined,
        undefined,
        1000,
        async () =>
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
      );
      const result = await provider.consult(request);
      expect(result.usage.inputTokens).toBe(100);
      expect(["refused", "incomplete"]).toContain(result.outcome);
    }
  });
  it("does not invent usage if it is absent", async () => {
    const provider = new OpenAIProvider(
      "test-key",
      undefined,
      undefined,
      1000,
      async () =>
        new Response(JSON.stringify(response(ready, { usage: null })), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(provider.consult(request)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
