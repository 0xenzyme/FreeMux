import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FreeMuxState, ModelHealth, StatusSummary } from "./types.js";

export function createEmptyState(now = new Date()): FreeMuxState {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    models: {}
  };
}

export async function loadState(statePath: string): Promise<FreeMuxState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FreeMuxState>;
    if (parsed.version !== 1 || typeof parsed.models !== "object" || parsed.models === null) {
      return createEmptyState();
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      lastSelectedModel: parsed.lastSelectedModel,
      lastCandidateCount: parsed.lastCandidateCount,
      lastDiscoveryAt: parsed.lastDiscoveryAt,
      models: parsed.models
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyState();
    }
    throw error;
  }
}

export async function saveState(statePath: string, state: FreeMuxState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function getModelHealth(state: FreeMuxState, modelId: string): ModelHealth {
  const existing = state.models[modelId];
  if (existing) {
    return existing;
  }
  const created: ModelHealth = {
    successCount: 0,
    failureCount: 0
  };
  state.models[modelId] = created;
  return created;
}

export function recordSuccess(state: FreeMuxState, modelId: string, latencyMs: number, now = new Date()): void {
  const health = getModelHealth(state, modelId);
  health.successCount += 1;
  health.lastLatencyMs = latencyMs;
  health.lastSuccessAt = now.toISOString();
  health.lastError = undefined;
  health.disabledUntil = undefined;
  state.lastSelectedModel = modelId;
  state.updatedAt = now.toISOString();
}

export function recordFailure(
  state: FreeMuxState,
  modelId: string,
  error: string,
  disableMs = 30_000,
  now = new Date()
): void {
  const health = getModelHealth(state, modelId);
  health.failureCount += 1;
  health.lastFailureAt = now.toISOString();
  health.lastError = error;
  health.disabledUntil = new Date(now.getTime() + disableMs).toISOString();
  state.updatedAt = now.toISOString();
}

export function summarizeState(statePath: string, state: FreeMuxState): StatusSummary {
  return {
    statePath,
    lastSelectedModel: state.lastSelectedModel,
    lastCandidateCount: state.lastCandidateCount,
    lastDiscoveryAt: state.lastDiscoveryAt,
    models: Object.entries(state.models)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, health]) => ({
        id,
        successCount: health.successCount,
        failureCount: health.failureCount,
        lastLatencyMs: health.lastLatencyMs,
        disabledUntil: health.disabledUntil,
        lastError: health.lastError
      }))
  };
}

export function recordDiscovery(state: FreeMuxState, candidateCount: number, now = new Date()): void {
  state.lastCandidateCount = candidateCount;
  state.lastDiscoveryAt = now.toISOString();
  state.updatedAt = now.toISOString();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
