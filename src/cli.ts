#!/usr/bin/env node
import { createServer } from "./server.js";
import { loadConfig, requireOpenRouterApiKey } from "./config.js";
import { OpenRouterClient } from "./openrouter.js";
import { ModelCatalog } from "./catalog.js";
import { loadState, summarizeState } from "./state.js";

async function main(argv: string[]): Promise<void> {
  const command = argv[0] || "--help";

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "serve") {
    await serve();
    return;
  }

  if (command === "status") {
    await status();
    return;
  }

  if (command === "models") {
    await models();
    return;
  }

  throw new Error(`Unknown command '${command}'. Run 'freemux --help'.`);
}

async function serve(): Promise<void> {
  const config = loadConfig();
  requireOpenRouterApiKey(config);
  const server = createServer(config);
  const requestedPort = config.port;

  await listen(server, config.host, requestedPort).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && !process.env.FREEMUX_PORT) {
      await listen(server, config.host, requestedPort + 1);
      config.port = requestedPort + 1;
      return;
    }
    throw error;
  });

  console.log(`FreeMux listening on http://${config.host}:${config.port}/v1`);
  console.log(`Model alias: ${config.modelAlias}`);
}

async function status(): Promise<void> {
  const config = loadConfig();
  const state = await loadState(config.statePath);
  const summary = summarizeState(config.statePath, state);

  console.log(`State: ${summary.statePath}`);
  console.log(`Last selected: ${summary.lastSelectedModel || "(none)"}`);
  console.log(`Last discovered candidates: ${summary.lastCandidateCount ?? "unknown"}`);
  if (summary.lastDiscoveryAt) {
    console.log(`Last discovery: ${summary.lastDiscoveryAt}`);
  }
  if (summary.models.length === 0) {
    console.log("No model health records yet.");
    return;
  }

  for (const model of summary.models) {
    const latency = model.lastLatencyMs === undefined ? "-" : `${model.lastLatencyMs}ms`;
    const disabled = model.disabledUntil ? ` disabledUntil=${model.disabledUntil}` : "";
    const error = model.lastError ? ` lastError=${model.lastError}` : "";
    console.log(`${model.id} ok=${model.successCount} fail=${model.failureCount} latency=${latency}${disabled}${error}`);
  }
}

async function models(): Promise<void> {
  const config = loadConfig();
  requireOpenRouterApiKey(config);
  const client = new OpenRouterClient({
    apiKey: config.openrouterApiKey || "",
    baseUrl: config.openrouterBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs
  });
  const catalog = new ModelCatalog(client, config.modelListTtlMs);
  const candidates = await catalog.getFreeCandidates(true);

  if (candidates.length === 0) {
    console.log("No free OpenRouter models discovered.");
    return;
  }

  for (const candidate of candidates) {
    const capabilities = Object.entries(candidate.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(",");
    const context = candidate.contextLength ? ` context=${candidate.contextLength}` : "";
    console.log(`${candidate.id}${context}${capabilities ? ` capabilities=${capabilities}` : ""}`);
  }
}

function listen(server: ReturnType<typeof createServer>, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function printHelp(): void {
  console.log(`FreeMux

Usage:
  freemux serve    Start the local OpenAI-compatible proxy
  freemux status   Show local model health state
  freemux models   List currently discovered OpenRouter free models

Environment:
  OPENROUTER_API_KEY       Required for serve/models
  OPENROUTER_BASE_URL      Optional, defaults to https://openrouter.ai/api/v1
  FREEMUX_HOST             Optional, defaults to 127.0.0.1
  FREEMUX_PORT             Optional, defaults to 4117
  FREEMUX_MODEL_ALIAS      Optional, defaults to freemodel
  FREEMUX_STATE_PATH       Optional, defaults to ~/.freemux/state.json
`);
}

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`freemux: ${message}`);
  process.exitCode = 1;
});
