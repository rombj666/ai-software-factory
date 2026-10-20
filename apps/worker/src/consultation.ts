import { and, asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@asf/db";
import {
  agentRuns,
  consultationMessages,
  lifecycleEvents,
  usageLogs,
  workflowJobs,
} from "@asf/db/schema";
import { nextAvailableAt } from "@asf/core";
import { budgetUsage, lockProject, saveState } from "@asf/agents/consultation";
import { consultationState, validatePlannerResponse } from "@asf/agents/schema";
import {
  estimatedUsd,
  loadPricing,
  type ModelPricing,
} from "@asf/agents/pricing";
import {
  OpenAIProvider,
  ProviderError,
  type AIProvider,
  type AIResult,
} from "@asf/agents/provider";
import { plannerRequest } from "@asf/agents/planner";
import type { ClaimedJob } from "./jobQueue";

export interface PlannerDependencies {
  provider: AIProvider;
  pricing: ModelPricing;
  maxInputTokens?: number;
}
function configuredPlanner(leaseSeconds: number): PlannerDependencies {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("..."))
    throw new ProviderError(
      "OpenAI is not configured on the Worker. Your messages are saved.",
      false,
      false,
    );
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini-2025-04-14";
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 2500);
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 45_000);
  const maxInputTokens = Number(process.env.OPENAI_MAX_INPUT_TOKENS ?? 32_000);
  if (
    ![maxOutputTokens, timeoutMs, maxInputTokens].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    timeoutMs + 30_000 >= leaseSeconds * 1000 ||
    maxOutputTokens > 16_000 ||
    maxInputTokens > 200_000
  ) {
    throw new ProviderError(
      "Invalid Planner limits: API timeout plus 30 seconds must fit inside the job lease.",
      false,
      false,
    );
  }
  let pricing: ModelPricing;
  try {
    pricing = loadPricing(model);
  } catch {
    throw new ProviderError(
      "Verified pricing is missing for the configured OpenAI model. Ask the operator to configure model rates.",
      false,
      false,
    );
  }
  return {
    provider: new OpenAIProvider(apiKey, model, maxOutputTokens, timeoutMs),
    pricing,
    maxInputTokens,
  };
}

/**
 * Each paid attempt has a durable reservation. A recovered in-flight attempt is
 * treated as uncertain, charged conservatively and never replayed automatically.
 * The response, usage, summary and job completion commit in one transaction.
 */
export async function handleConsultationTurn(
  db: DbClient,
  job: ClaimedJob,
  workerId: string,
  leaseSeconds: number,
  injected?: PlannerDependencies,
) {
  if (!job.projectId) throw new Error("Consultation job has no project");
  const projectId = job.projectId;
  let dependencies: PlannerDependencies | undefined;
  let configurationError: string | undefined;
  try {
    dependencies = injected ?? configuredPlanner(leaseSeconds);
  } catch (error) {
    configurationError =
      error instanceof ProviderError
        ? error.message
        : "Planner configuration is invalid.";
  }
  const prepared = await db.transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const state = consultationState(project.currentState);
    const [queuedJob] = await tx
      .select()
      .from(workflowJobs)
      .where(eq(workflowJobs.id, job.id));
    if (
      !queuedJob ||
      queuedJob.status !== "claimed" ||
      queuedJob.claimedBy !== workerId ||
      !queuedJob.leaseExpiresAt ||
      queuedJob.leaseExpiresAt <= new Date()
    )
      return null;
    if (
      project.status !== "consultation" ||
      state.activeJobId !== job.id ||
      state.revision !== job.payload.revision
    ) {
      await tx
        .update(workflowJobs)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          leaseExpiresAt: null,
          claimedBy: null,
        })
        .where(eq(workflowJobs.id, job.id));
      return null;
    }
    const runs = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.projectId, projectId),
          eq(agentRuns.agentType, "planner_consultation"),
        ),
      );
    const interrupted = runs.find(
      (run) => run.input?.jobId === job.id && run.status === "running",
    );
    if (interrupted) {
      const reservation = Number(interrupted.input?.reservationUsd ?? 0);
      await tx
        .insert(usageLogs)
        .values({
          projectId,
          kind: "external_api",
          provider: "openai",
          amount: reservation.toFixed(6),
          unit: "USD",
          metadata: {
            agentRunId: interrupted.id,
            jobId: job.id,
            model: interrupted.input?.model,
            costBasis: "uncertain_reserved_upper_bound",
            actualTokensKnown: false,
            note: "Worker restarted before a paid result was durably confirmed.",
          },
        });
      await tx
        .update(agentRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error:
            "Worker interrupted; paid outcome unknown. Reservation retained conservatively.",
        })
        .where(eq(agentRuns.id, interrupted.id));
      const error =
        "The previous Worker stopped before confirming the AI result. Its reserved cost is retained; review usage before an explicit Retry.";
      await tx
        .update(workflowJobs)
        .set({
          status: "failed",
          error,
          finishedAt: new Date(),
          claimedBy: null,
          leaseExpiresAt: null,
        })
        .where(eq(workflowJobs.id, job.id));
      await saveState(tx, project, {
        ...state,
        status: "failed",
        activeJobId: null,
        error,
      });
      return null;
    }
    const history = await tx
      .select()
      .from(consultationMessages)
      .where(eq(consultationMessages.projectId, projectId))
      .orderBy(
        asc(consultationMessages.createdAt),
        asc(consultationMessages.id),
      );
    const request = plannerRequest(
      project.title,
      project.idea,
      history
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        })),
      state.summary,
    );
    const inputBound = dependencies?.provider.inputTokenBound(request) ?? 0;
    let error = configurationError;
    if (
      dependencies &&
      (!Number.isSafeInteger(inputBound) ||
        inputBound <= 0 ||
        inputBound > (dependencies.maxInputTokens ?? 32_000))
    )
      error =
        "This conversation exceeds the configured Planner input limit. No paid request was made.";
    const reservationUsd = dependencies
      ? estimatedUsd(
          {
            inputTokens: inputBound,
            cachedInputTokens: 0,
            outputTokens: dependencies.provider.maxOutputTokens,
          },
          dependencies.pricing,
        )
      : 0;
    const budget = await budgetUsage(tx, projectId);
    if (
      !error &&
      budget.spentUsd + budget.reservedUsd + reservationUsd >
        project.budgetLimitCents / 100 + 1e-9
    )
      error =
        "The project budget cannot cover another Planner response. No paid request was made.";
    if (error) {
      await tx
        .insert(agentRuns)
        .values({
          projectId,
          agentType: "planner_consultation",
          status: "failed",
          input: { jobId: job.id, revision: state.revision },
          error,
          finishedAt: new Date(),
        });
      await tx
        .update(workflowJobs)
        .set({
          status: "failed",
          error,
          finishedAt: new Date(),
          claimedBy: null,
          leaseExpiresAt: null,
        })
        .where(eq(workflowJobs.id, job.id));
      await saveState(tx, project, {
        ...state,
        status: "failed",
        activeJobId: null,
        error,
      });
      return null;
    }
    const [run] = await tx
      .insert(agentRuns)
      .values({
        projectId,
        agentType: "planner_consultation",
        status: "running",
        input: {
          jobId: job.id,
          revision: state.revision,
          reservationUsd,
          inputTokenBound: inputBound,
          model: dependencies!.provider.model,
          pricing: dependencies!.pricing,
        },
        startedAt: new Date(),
      })
      .returning();
    if (!run) throw new Error("Agent run insert failed");
    await tx
      .update(workflowJobs)
      .set({ status: "running" })
      .where(eq(workflowJobs.id, job.id));
    await saveState(tx, project, {
      ...state,
      status: "processing",
      error: null,
    });
    return { request, run, reservationUsd, pricing: dependencies!.pricing };
  });
  if (!prepared || !dependencies) return;
  const started = performance.now();
  let response: AIResult | undefined;
  let failure: ProviderError | undefined;
  try {
    response = await dependencies.provider.consult(prepared.request);
  } catch (error) {
    failure =
      error instanceof ProviderError
        ? error
        : new ProviderError(
            "The AI request failed without a confirmed outcome. Review usage before retrying.",
            false,
            true,
          );
  }
  let parsed: ReturnType<typeof validatePlannerResponse> | undefined;
  if (response) {
    try {
      if (response.outcome !== "completed")
        throw new Error("Incomplete or refused response");
      parsed = validatePlannerResponse(response.value);
    } catch {
      failure = new ProviderError(
        "The Planner returned an incomplete, refused, or invalid response. Your messages are saved; you can retry.",
        false,
        false,
      );
    }
  }
  // Deliberately outside the API catch: database failures propagate to the
  // Worker's database circuit breaker and retain the durable reservation.
  await db.transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const state = consultationState(project.currentState);
    const [run] = await tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, prepared.run.id));
    if (!run || run.status !== "running") return;
    const now = new Date();
    if (response) {
      const amount = estimatedUsd(response.usage, prepared.pricing);
      await tx
        .insert(usageLogs)
        .values({
          projectId,
          kind: "tokens",
          provider: "openai",
          amount: amount.toFixed(6),
          unit: "USD",
          metadata: {
            agentRunId: run.id,
            jobId: job.id,
            responseId: response.id,
            model: response.model,
            ...response.usage,
            durationMs: response.durationMs,
            pricing: prepared.pricing,
            costBasis: "estimated_from_reported_tokens",
            reservationUsd: prepared.reservationUsd,
          },
        });
    } else if (failure?.uncertain) {
      await tx
        .insert(usageLogs)
        .values({
          projectId,
          kind: "external_api",
          provider: "openai",
          amount: prepared.reservationUsd.toFixed(6),
          unit: "USD",
          metadata: {
            agentRunId: run.id,
            jobId: job.id,
            model: prepared.pricing.model,
            costBasis: "uncertain_reserved_upper_bound",
            actualTokensKnown: false,
            durationMs: Math.round(performance.now() - started),
          },
        });
    }
    const current =
      project.status === "consultation" &&
      state.activeJobId === job.id &&
      state.revision === job.payload.revision;
    if (!current)
      failure = new ProviderError(
        "This response was superseded by a newer conversation revision.",
        false,
        false,
      );
    if (failure || !parsed) {
      const error =
        failure?.message ?? "The Planner did not return a valid response.";
      const retry =
        current && failure?.retryable === true && job.attempts + 1 < 3;
      await tx
        .update(agentRuns)
        .set({
          status: "failed",
          error,
          finishedAt: now,
          output: {
            durationMs:
              response?.durationMs ?? Math.round(performance.now() - started),
            ...(response
              ? { responseId: response.id, usage: response.usage }
              : {}),
          },
        })
        .where(eq(agentRuns.id, run.id));
      await tx
        .update(workflowJobs)
        .set({
          status: retry ? "queued" : "failed",
          attempts: job.attempts + 1,
          error,
          claimedBy: null,
          leaseExpiresAt: null,
          finishedAt: retry ? null : now,
          availableAt: retry ? nextAvailableAt(now, job.attempts + 1) : now,
          updatedAt: now,
        })
        .where(eq(workflowJobs.id, job.id));
      if (current)
        await saveState(tx, project, {
          ...state,
          status: retry ? "queued" : "failed",
          activeJobId: retry ? job.id : null,
          error,
        });
      await tx
        .insert(lifecycleEvents)
        .values({
          projectId,
          eventType: retry
            ? "consultation.retry_queued"
            : "consultation.failed",
          payload: { jobId: job.id, agentRunId: run.id, error },
        });
      return;
    }
    await tx
      .insert(consultationMessages)
      .values({
        projectId,
        role: "assistant",
        createdAt: sql`clock_timestamp()`,
        content: [
          parsed.message,
          ...parsed.questions.map((question) => `• ${question}`),
        ].join("\n\n"),
        metadata: {
          jobId: job.id,
          agentRunId: run.id,
          responseId: response!.id,
          revision: state.revision,
        },
      });
    await tx
      .update(agentRuns)
      .set({
        status: "succeeded",
        finishedAt: now,
        output: {
          ...parsed,
          responseId: response!.id,
          usage: response!.usage,
          durationMs: response!.durationMs,
        },
      })
      .where(eq(agentRuns.id, run.id));
    await tx
      .update(workflowJobs)
      .set({
        status: "succeeded",
        result: { agentRunId: run.id },
        finishedAt: now,
        updatedAt: now,
        claimedBy: null,
        leaseExpiresAt: null,
        error: null,
      })
      .where(eq(workflowJobs.id, job.id));
    await saveState(tx, project, {
      ...state,
      status: parsed.readyToComplete ? "ready" : "collecting",
      activeJobId: null,
      error: null,
      summary: parsed.summary,
      readyToComplete: parsed.readyToComplete,
    });
    await tx
      .insert(lifecycleEvents)
      .values({
        projectId,
        eventType: "consultation.responded",
        payload: {
          jobId: job.id,
          agentRunId: run.id,
          readyToComplete: parsed.readyToComplete,
        },
      });
  });
}
