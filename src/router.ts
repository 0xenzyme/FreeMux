import { LocalRequestError, UpstreamHttpError, UpstreamNetworkError } from "./errors.js";
import { detectRequiredCapabilities, filterCandidatesForRequest } from "./models.js";
import { loadState, recordDiscovery, recordFailure, recordSuccess, saveState } from "./state.js";
import type { ModelCatalog } from "./catalog.js";
import type { OpenRouterClient } from "./openrouter.js";
import type { CandidateModel, ChatCompletionRequest, CompletionResult, FreeMuxConfig, FreeMuxState } from "./types.js";

export class FreeMuxRouter {
  private readonly config: FreeMuxConfig;
  private readonly catalog: ModelCatalog;
  private readonly client: OpenRouterClient;

  constructor(config: FreeMuxConfig, catalog: ModelCatalog, client: OpenRouterClient) {
    this.config = config;
    this.catalog = catalog;
    this.client = client;
  }

  async complete(request: ChatCompletionRequest): Promise<CompletionResult> {
    const state = await loadState(this.config.statePath);
    const allCandidates = await this.catalog.getFreeCandidates();
    recordDiscovery(state, allCandidates.length);
    await saveState(this.config.statePath, state);
    const candidates = this.resolveCandidates(request, allCandidates, state);

    if (candidates.length === 0) {
      throw new LocalRequestError(400, "no_eligible_free_models", "No eligible OpenRouter free models are currently available.");
    }

    let lastError: unknown;
    let refreshedAfterDisappearance = false;
    let attemptCount = 0;
    const attempted = new Set<string>();

    for (let index = 0; index < candidates.length && attemptCount < this.config.maxAttempts; index += 1) {
      const candidate = candidates[index];
      if (attempted.has(candidate.id)) {
        continue;
      }
      attempted.add(candidate.id);
      attemptCount += 1;

      const startedAt = Date.now();
      try {
        const result = await this.client.createChatCompletion(request, candidate.id);
        recordSuccess(state, candidate.id, Date.now() - startedAt);
        await saveState(this.config.statePath, state);
        return result;
      } catch (error) {
        lastError = error;
        this.recordCandidateFailure(state, candidate.id, error);
        await saveState(this.config.statePath, state);

        if (!shouldFallback(error) || request.model !== this.config.modelAlias) {
          throw error;
        }

        if (isDisappearedModelError(error) && !refreshedAfterDisappearance && attemptCount < this.config.maxAttempts) {
          const refreshedCandidates = await this.catalog.getFreeCandidates(true);
          recordDiscovery(state, refreshedCandidates.length);
          await saveState(this.config.statePath, state);
          const refreshedEligible = this.resolveCandidates(request, refreshedCandidates, state);
          candidates.splice(
            index + 1,
            candidates.length,
            ...refreshedEligible.filter((next) => !attempted.has(next.id))
          );
          refreshedAfterDisappearance = true;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("All fallback attempts failed.");
  }

  private resolveCandidates(
    request: ChatCompletionRequest,
    allCandidates: CandidateModel[],
    state: FreeMuxState
  ): CandidateModel[] {
    if (request.model !== this.config.modelAlias) {
      const explicit = allCandidates.find((candidate) => candidate.id === request.model);
      if (!explicit) {
        throw new LocalRequestError(400, "model_not_free_or_unknown", `Model '${request.model}' is not a known free OpenRouter model.`);
      }
      return [explicit];
    }

    const required = detectRequiredCapabilities(request);
    const eligible = filterCandidatesForRequest(allCandidates, required);
    return orderCandidates(eligible, state);
  }

  private recordCandidateFailure(state: FreeMuxState, modelId: string, error: unknown): void {
    if (error instanceof UpstreamHttpError) {
      recordFailure(state, modelId, `HTTP ${error.status}`, disableDurationForStatus(error.status));
      return;
    }

    if (error instanceof UpstreamNetworkError) {
      recordFailure(state, modelId, error.message, 30_000);
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    recordFailure(state, modelId, message, 30_000);
  }
}

export function orderCandidates(candidates: CandidateModel[], state: FreeMuxState, now = new Date()): CandidateModel[] {
  return [...candidates]
    .filter((candidate) => {
      const disabledUntil = state.models[candidate.id]?.disabledUntil;
      return !disabledUntil || Date.parse(disabledUntil) <= now.getTime();
    })
    .sort((left, right) => {
      const leftHealth = state.models[left.id];
      const rightHealth = state.models[right.id];
      const leftFailureRate = failureRate(leftHealth?.successCount || 0, leftHealth?.failureCount || 0);
      const rightFailureRate = failureRate(rightHealth?.successCount || 0, rightHealth?.failureCount || 0);

      if (leftFailureRate !== rightFailureRate) {
        return leftFailureRate - rightFailureRate;
      }

      const leftLatency = leftHealth?.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
      const rightLatency = rightHealth?.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
      if (leftLatency !== rightLatency) {
        return leftLatency - rightLatency;
      }

      return left.id.localeCompare(right.id);
    });
}

export function shouldFallback(error: unknown): boolean {
  if (error instanceof UpstreamNetworkError) {
    return true;
  }
  if (error instanceof UpstreamHttpError) {
    return error.status === 403 || error.status === 404 || error.status === 429 || error.status >= 500;
  }
  return false;
}

export function isDisappearedModelError(error: unknown): boolean {
  return error instanceof UpstreamHttpError && error.status === 404;
}

export function disableDurationForStatus(status: number): number {
  if (status === 429) {
    return 60_000;
  }
  if (status === 404) {
    return 5 * 60_000;
  }
  if (status >= 500) {
    return 30_000;
  }
  return 15_000;
}

function failureRate(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  return total === 0 ? 0 : failureCount / total;
}
