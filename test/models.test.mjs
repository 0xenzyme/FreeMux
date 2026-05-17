import assert from "node:assert/strict";
import test from "node:test";
import {
  detectRequiredCapabilities,
  filterCandidatesForRequest,
  freeCandidatesFromModels,
  isFreeModel,
  parsePrice
} from "../dist/models.js";

test("parsePrice handles zero strings and numbers", () => {
  assert.equal(parsePrice(0), 0);
  assert.equal(parsePrice("0"), 0);
  assert.equal(parsePrice("0.000000"), 0);
  assert.equal(parsePrice("0.25"), 0.25);
  assert.equal(parsePrice("not-a-number"), null);
  assert.equal(parsePrice(undefined), null);
});

test("isFreeModel requires prompt and completion to be zero", () => {
  assert.equal(isFreeModel({ id: "free", pricing: { prompt: "0", completion: "0" } }), true);
  assert.equal(isFreeModel({ id: "paid", pricing: { prompt: "0", completion: "0.1" } }), false);
  assert.equal(isFreeModel({ id: "missing" }), false);
});

test("freeCandidatesFromModels filters paid models and extracts capabilities", () => {
  const candidates = freeCandidatesFromModels([
    {
      id: "paid",
      pricing: { prompt: "0.1", completion: "0" }
    },
    {
      id: "tool-json",
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools", "response_format"]
    },
    {
      id: "vision",
      pricing: { prompt: 0, completion: 0 },
      architecture: { input_modalities: ["text", "image"] }
    }
  ]);

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["tool-json", "vision"]);
  assert.equal(candidates[0].capabilities.tools, true);
  assert.equal(candidates[0].capabilities.json, true);
  assert.equal(candidates[1].capabilities.vision, true);
});

test("detectRequiredCapabilities detects tools, json mode, and image inputs", () => {
  const required = detectRequiredCapabilities({
    model: "freemodel",
    tools: [{ type: "function" }],
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } }
        ]
      }
    ]
  });

  assert.deepEqual(required, { tools: true, json: true, vision: true });
});

test("filterCandidatesForRequest requires vision and prefers advertised optional capabilities", () => {
  const candidates = [
    { id: "basic", name: "basic", capabilities: { tools: false, json: false, vision: false } },
    { id: "tools", name: "tools", capabilities: { tools: true, json: false, vision: false } },
    { id: "vision-tools", name: "vision-tools", capabilities: { tools: true, json: true, vision: true } }
  ];

  assert.deepEqual(
    filterCandidatesForRequest(candidates, { tools: true, json: false, vision: false }).map((candidate) => candidate.id),
    ["tools", "vision-tools"]
  );
  assert.deepEqual(
    filterCandidatesForRequest(candidates, { tools: false, json: false, vision: true }).map((candidate) => candidate.id),
    ["vision-tools"]
  );
});
