export class LocalRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LocalRequestError";
    this.status = status;
    this.code = code;
  }
}

export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly upstreamModel?: string;

  constructor(status: number, body: string, upstreamModel?: string) {
    super(`OpenRouter returned HTTP ${status}`);
    this.name = "UpstreamHttpError";
    this.status = status;
    this.body = body;
    this.upstreamModel = upstreamModel;
  }
}

export class UpstreamNetworkError extends Error {
  readonly upstreamModel?: string;

  constructor(message: string, upstreamModel?: string) {
    super(message);
    this.name = "UpstreamNetworkError";
    this.upstreamModel = upstreamModel;
  }
}

export function openAiError(status: number, code: string, message: string): string {
  return JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code
    }
  });
}
