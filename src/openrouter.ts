import { UpstreamHttpError, UpstreamNetworkError } from "./errors.js";
import type { ChatCompletionRequest, CompletionResult, OpenRouterModelsResponse } from "./types.js";

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async fetchModels(): Promise<OpenRouterModelsResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.defaultHeaders()
    });

    const body = await response.text();
    if (!response.ok) {
      throw new UpstreamHttpError(response.status, body);
    }

    return JSON.parse(body) as OpenRouterModelsResponse;
  }

  async createChatCompletion(request: ChatCompletionRequest, upstreamModel: string): Promise<CompletionResult> {
    const upstreamRequest = {
      ...request,
      model: upstreamModel
    };

    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.defaultHeaders(),
        "content-type": "application/json",
        "x-title": "FreeMux"
      },
      body: JSON.stringify(upstreamRequest)
    }, upstreamModel);

    const body = await response.text();
    if (!response.ok) {
      throw new UpstreamHttpError(response.status, body, upstreamModel);
    }

    return {
      status: response.status,
      body,
      contentType: response.headers.get("content-type") || "application/json",
      upstreamModel
    };
  }

  private defaultHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json"
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit, upstreamModel?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new UpstreamNetworkError(message, upstreamModel);
    } finally {
      clearTimeout(timeout);
    }
  }
}
