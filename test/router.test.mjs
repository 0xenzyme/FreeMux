import assert from "node:assert/strict";
import test from "node:test";
import { UpstreamHttpError, UpstreamNetworkError } from "../dist/errors.js";
import { disableDurationForStatus, orderCandidates, shouldFallback } from "../dist/router.js";

test("orderCandidates excludes disabled models and sorts by failure rate, latency, id", () => {
  const now = new Date("2026-05-05T00:00:00.000Z");
  const candidates = [
    { id: "c", name: "c", capabilities: { tools: false, json: false, vision: false } },
    { id: "a", name: "a", capabilities: { tools: false, json: false, vision: false } },
    { id: "b", name: "b", capabilities: { tools: false, json: false, vision: false } },
    { id: "disabled", name: "disabled", capabilities: { tools: false, json: false, vision: false } }
  ];
  const state = {
    version: 1,
    updatedAt: now.toISOString(),
    models: {
      a: { successCount: 5, failureCount: 1, lastLatencyMs: 100 },
      b: { successCount: 5, failureCount: 1, lastLatencyMs: 80 },
      c: { successCount: 0, failureCount: 0 },
      disabled: { successCount: 10, failureCount: 0, disabledUntil: "2026-05-05T00:01:00.000Z" }
    }
  };

  assert.deepEqual(orderCandidates(candidates, state, now).map((candidate) => candidate.id), ["c", "b", "a"]);
});

test("shouldFallback only retries upstream/model-specific failures", () => {
  assert.equal(shouldFallback(new UpstreamNetworkError("socket closed")), true);
  assert.equal(shouldFallback(new UpstreamHttpError(429, "rate limit")), true);
  assert.equal(shouldFallback(new UpstreamHttpError(404, "gone")), true);
  assert.equal(shouldFallback(new UpstreamHttpError(500, "provider down")), true);
  assert.equal(shouldFallback(new UpstreamHttpError(401, "bad key")), false);
  assert.equal(shouldFallback(new UpstreamHttpError(400, "bad request")), false);
  assert.equal(shouldFallback(new Error("local validation")), false);
});

test("disableDurationForStatus gives longer cooldowns to 404 and 429", () => {
  assert.equal(disableDurationForStatus(429), 60_000);
  assert.equal(disableDurationForStatus(404), 300_000);
  assert.equal(disableDurationForStatus(500), 30_000);
  assert.equal(disableDurationForStatus(400), 15_000);
});
