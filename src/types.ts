export type JsonObject = Record<string, unknown>;

export interface ChatCompletionRequest extends JsonObject {
  model: string;
  messages: unknown[];
  stream?: boolean;
  tools?: unknown[];
  response_format?: {
    type?: string;
    [key: string]: unknown;
  };
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
    request?: string | number | null;
    image?: string | number | null;
    [key: string]: unknown;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    [key: string]: unknown;
  };
  supported_parameters?: string[];
  [key: string]: unknown;
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export interface ModelCapabilities {
  tools: boolean;
  json: boolean;
  vision: boolean;
}

export interface RequiredCapabilities {
  tools: boolean;
  json: boolean;
  vision: boolean;
}

export interface CandidateModel {
  id: string;
  name: string;
  contextLength?: number;
  capabilities: ModelCapabilities;
}

export interface ModelHealth {
  successCount: number;
  failureCount: number;
  lastLatencyMs?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  disabledUntil?: string;
}

export interface FreeMuxState {
  version: 1;
  updatedAt: string;
  lastSelectedModel?: string;
  lastCandidateCount?: number;
  lastDiscoveryAt?: string;
  models: Record<string, ModelHealth>;
}

export interface FreeMuxConfig {
  host: string;
  port: number;
  statePath: string;
  modelAlias: string;
  openrouterApiKey?: string;
  openrouterBaseUrl: string;
  modelListTtlMs: number;
  maxAttempts: number;
  requestTimeoutMs: number;
}

export interface CompletionResult {
  status: number;
  body: string;
  contentType: string;
  upstreamModel: string;
}

export interface StatusSummary {
  statePath: string;
  lastSelectedModel?: string;
  lastCandidateCount?: number;
  lastDiscoveryAt?: string;
  models: Array<{
    id: string;
    successCount: number;
    failureCount: number;
    lastLatencyMs?: number;
    disabledUntil?: string;
    lastError?: string;
  }>;
}
