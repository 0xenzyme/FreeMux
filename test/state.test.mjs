import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadState, recordDiscovery, recordFailure, recordSuccess, saveState, summarizeState } from "../dist/state.js";

test("state initializes, records, persists, and summarizes health", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freemux-state-"));
  const statePath = join(dir, "state.json");

  try {
    const state = await loadState(statePath);
    assert.equal(state.version, 1);
    assert.deepEqual(state.models, {});

    recordSuccess(state, "model-a", 42, new Date("2026-05-05T00:00:00.000Z"));
    recordFailure(state, "model-b", "HTTP 429", 60_000, new Date("2026-05-05T00:00:00.000Z"));
    recordDiscovery(state, 2, new Date("2026-05-05T00:00:01.000Z"));
    await saveState(statePath, state);

    const reloaded = await loadState(statePath);
    assert.equal(reloaded.models["model-a"].successCount, 1);
    assert.equal(reloaded.models["model-b"].failureCount, 1);

    const summary = summarizeState(statePath, reloaded);
    assert.equal(summary.lastSelectedModel, "model-a");
    assert.equal(summary.lastCandidateCount, 2);
    assert.equal(summary.lastDiscoveryAt, "2026-05-05T00:00:01.000Z");
    assert.deepEqual(summary.models.map((model) => model.id), ["model-a", "model-b"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
