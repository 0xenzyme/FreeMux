import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ModelCatalog } from "./catalog.js";
import { LocalRequestError, openAiError, UpstreamHttpError, UpstreamNetworkError } from "./errors.js";
import { OpenRouterClient } from "./openrouter.js";
import { FreeMuxRouter } from "./router.js";
import type { ChatCompletionRequest, FreeMuxConfig } from "./types.js";

export function createServer(config: FreeMuxConfig): Server {
  const client = new OpenRouterClient({
    apiKey: config.openrouterApiKey || "",
    baseUrl: config.openrouterBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs
  });
  const catalog = new ModelCatalog(client, config.modelListTtlMs);
  const router = new FreeMuxRouter(config, catalog, client);

  return createHttpServer(async (request, response) => {
    try {
      await routeRequest(request, response, config, router);
    } catch (error) {
      writeError(response, error);
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: FreeMuxConfig,
  router: FreeMuxRouter
): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { status: "ok", name: "freemux" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    writeJson(response, 200, {
      object: "list",
      data: [
        {
          id: config.modelAlias,
          object: "model",
          created: 0,
          owned_by: "freemux"
        }
      ]
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJsonBody(request);
    const chatRequest = validateChatCompletionRequest(body);
    if (chatRequest.stream === true) {
      throw new LocalRequestError(501, "streaming_not_supported", "FreeMux MVP supports non-streaming chat completions only.");
    }

    const result = await router.complete(chatRequest);
    response.writeHead(result.status, {
      "content-type": result.contentType,
      "x-freemux-upstream-model": result.upstreamModel
    });
    response.end(result.body);
    return;
  }

  throw new LocalRequestError(404, "not_found", `Unsupported route: ${request.method || "GET"} ${url.pathname}`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    throw new LocalRequestError(400, "invalid_json", "Request body must be valid JSON.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new LocalRequestError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function validateChatCompletionRequest(body: unknown): ChatCompletionRequest {
  if (typeof body !== "object" || body === null) {
    throw new LocalRequestError(400, "invalid_request", "Request body must be a JSON object.");
  }
  const candidate = body as Partial<ChatCompletionRequest>;
  if (typeof candidate.model !== "string" || candidate.model.trim() === "") {
    throw new LocalRequestError(400, "missing_model", "Request must include a model string.");
  }
  if (!Array.isArray(candidate.messages)) {
    throw new LocalRequestError(400, "missing_messages", "Request must include a messages array.");
  }
  return candidate as ChatCompletionRequest;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  if (error instanceof LocalRequestError) {
    response.writeHead(error.status, { "content-type": "application/json" });
    response.end(openAiError(error.status, error.code, error.message));
    return;
  }

  if (error instanceof UpstreamHttpError) {
    const status = error.status === 401 || error.status === 403 ? error.status : 502;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(openAiError(status, "upstream_error", error.body || error.message));
    return;
  }

  if (error instanceof UpstreamNetworkError) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(openAiError(502, "upstream_network_error", error.message));
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  response.writeHead(500, { "content-type": "application/json" });
  response.end(openAiError(500, "internal_error", message));
}
