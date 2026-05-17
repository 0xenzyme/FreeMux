import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "../dist/server.js";
import { loadState } from "../dist/state.js";

test("server exposes health and model alias", async () => {
  const fixture = await createFixture();
  try {
    const health = await fetch(`${fixture.localBaseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", name: "freemux" });

    const models = await fetch(`${fixture.localBaseUrl}/v1/models`);
    const body = await models.json();
    assert.equal(models.status, 200);
    assert.equal(body.data[0].id, "freemodel");
  } finally {
    await fixture.close();
  }
});

test("chat completions proxy to a free model and expose upstream header", async () => {
  const fixture = await createFixture({
    completions: {
      "alpha/free": { status: 200, body: completionBody("alpha/free") }
    }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-freemux-upstream-model"), "alpha/free");
    const body = await response.json();
    assert.equal(body.model, "alpha/free");
    assert.equal(fixture.requests.completions.length, 1);
    assert.equal(fixture.requests.completions[0].model, "alpha/free");
  } finally {
    await fixture.close();
  }
});

test("chat completions fallback from failing candidate to second free model", async () => {
  const fixture = await createFixture({
    completions: {
      "alpha/free": { status: 429, body: { error: { message: "rate limit" } } },
      "beta/free": { status: 200, body: completionBody("beta/free") }
    }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-freemux-upstream-model"), "beta/free");
    assert.deepEqual(fixture.requests.completions.map((request) => request.model), ["alpha/free", "beta/free"]);

    const state = await loadState(fixture.statePath);
    assert.equal(state.models["alpha/free"].failureCount, 1);
    assert.equal(state.models["beta/free"].successCount, 1);
  } finally {
    await fixture.close();
  }
});

test("404 fallback refreshes cached discovery when a model disappears", async () => {
  const fixture = await createFixture({
    modelResponses: [
      {
        data: [
          { id: "alpha/free", pricing: { prompt: "0", completion: "0" } }
        ]
      },
      {
        data: [
          { id: "delta/free", pricing: { prompt: "0", completion: "0" } }
        ]
      }
    ],
    completions: {
      "alpha/free": { status: 404, body: { error: { message: "model gone" } } },
      "delta/free": { status: 200, body: completionBody("delta/free") }
    }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-freemux-upstream-model"), "delta/free");
    assert.deepEqual(fixture.requests.models, 2);
    assert.deepEqual(fixture.requests.completions.map((request) => request.model), ["alpha/free", "delta/free"]);
  } finally {
    await fixture.close();
  }
});

test("empty discovery result is persisted for status observability", async () => {
  const fixture = await createFixture({
    modelResponses: [{ data: [] }]
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 400);
    const state = await loadState(fixture.statePath);
    assert.equal(state.lastCandidateCount, 0);
    assert.equal(fixture.requests.completions.length, 0);
  } finally {
    await fixture.close();
  }
});

test("empty refresh after disappeared model is persisted", async () => {
  const fixture = await createFixture({
    modelResponses: [
      {
        data: [
          { id: "alpha/free", pricing: { prompt: "0", completion: "0" } }
        ]
      },
      { data: [] }
    ],
    completions: {
      "alpha/free": { status: 404, body: { error: { message: "model gone" } } }
    }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 502);
    assert.deepEqual(fixture.requests.models, 2);
    const state = await loadState(fixture.statePath);
    assert.equal(state.lastCandidateCount, 0);
    assert.equal(state.models["alpha/free"].failureCount, 1);
  } finally {
    await fixture.close();
  }
});

test("invalid local requests fail without upstream calls", async () => {
  const fixture = await createFixture();
  try {
    const response = await fetch(`${fixture.localBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "freemodel" })
    });

    assert.equal(response.status, 400);
    assert.equal(fixture.requests.completions.length, 0);
  } finally {
    await fixture.close();
  }
});

test("streaming is explicitly unsupported in MVP", async () => {
  const fixture = await createFixture();
  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      stream: true,
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 501);
    assert.equal(fixture.requests.completions.length, 0);
  } finally {
    await fixture.close();
  }
});

test("upstream auth failure is not blindly retried", async () => {
  const fixture = await createFixture({
    completions: {
      "alpha/free": { status: 401, body: { error: { message: "bad key" } } }
    }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 401);
    assert.deepEqual(fixture.requests.completions.map((request) => request.model), ["alpha/free"]);
  } finally {
    await fixture.close();
  }
});

test("model discovery auth failure is surfaced without fallback masking", async () => {
  const fixture = await createFixture({
    modelsStatus: 401,
    modelsBody: { error: { message: "bad key" } }
  });

  try {
    const response = await postChat(fixture.localBaseUrl, {
      model: "freemodel",
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(response.status, 401);
    assert.equal(fixture.requests.completions.length, 0);
  } finally {
    await fixture.close();
  }
});

async function createFixture(options = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "freemux-server-"));
  const statePath = join(tempDir, "state.json");
  const requests = { completions: [], models: 0 };
  const completions = options.completions || {};
  const modelResponses = options.modelResponses || [
    {
      data: [
        { id: "alpha/free", pricing: { prompt: "0", completion: "0" } },
        { id: "beta/free", pricing: { prompt: "0", completion: "0" } },
        { id: "gamma/paid", pricing: { prompt: "0.1", completion: "0" } }
      ]
    }
  ];

  const upstream = createHttpServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/models") {
      const modelResponse = modelResponses[Math.min(requests.models, modelResponses.length - 1)];
      requests.models += 1;
      writeJson(response, options.modelsStatus || 200, options.modelsBody || modelResponse);
      return;
    }

    if (request.method === "POST" && request.url === "/chat/completions") {
      const body = await readJson(request);
      requests.completions.push(body);
      const configured = completions[body.model] || { status: 200, body: completionBody(body.model) };
      writeJson(response, configured.status, configured.body);
      return;
    }

    writeJson(response, 404, { error: { message: "not found" } });
  });
  await listen(upstream);
  const upstreamPort = upstream.address().port;

  const app = createServer({
    host: "127.0.0.1",
    port: 0,
    statePath,
    modelAlias: "freemodel",
    openrouterApiKey: "test-key",
    openrouterBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    modelListTtlMs: 60_000,
    maxAttempts: 3,
    requestTimeoutMs: 5_000
  });
  await listen(app);
  const appPort = app.address().port;

  return {
    localBaseUrl: `http://127.0.0.1:${appPort}`,
    statePath,
    requests,
    async close() {
      await closeServer(app);
      await closeServer(upstream);
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

function completionBody(model) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop"
      }
    ]
  };
}

async function postChat(baseUrl, body) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
