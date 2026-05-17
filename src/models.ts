import type {
  CandidateModel,
  ChatCompletionRequest,
  ModelCapabilities,
  OpenRouterModel,
  RequiredCapabilities
} from "./types.js";

export function parsePrice(value: unknown): number | null {
  if (value === 0 || value === "0" || value === "0.0" || value === "0.000000") {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isFreeModel(model: OpenRouterModel): boolean {
  const pricing = model.pricing;
  if (!pricing) {
    return false;
  }
  const prompt = parsePrice(pricing.prompt);
  const completion = parsePrice(pricing.completion);
  return prompt === 0 && completion === 0;
}

export function toCandidateModel(model: OpenRouterModel): CandidateModel {
  return {
    id: model.id,
    name: model.name || model.id,
    contextLength: model.context_length,
    capabilities: extractCapabilities(model)
  };
}

export function extractCapabilities(model: OpenRouterModel): ModelCapabilities {
  const supported = new Set((model.supported_parameters || []).map((value) => value.toLowerCase()));
  const inputModalities = new Set((model.architecture?.input_modalities || []).map((value) => value.toLowerCase()));
  const outputModalities = new Set((model.architecture?.output_modalities || []).map((value) => value.toLowerCase()));

  return {
    tools: supported.has("tools") || supported.has("tool_choice"),
    json: supported.has("response_format") || supported.has("structured_outputs"),
    vision: inputModalities.has("image") || outputModalities.has("image")
  };
}

export function detectRequiredCapabilities(request: ChatCompletionRequest): RequiredCapabilities {
  return {
    tools: Array.isArray(request.tools) && request.tools.length > 0,
    json: typeof request.response_format?.type === "string" && request.response_format.type !== "text",
    vision: request.messages.some(messageHasImageInput)
  };
}

export function filterCandidatesForRequest(
  candidates: CandidateModel[],
  required: RequiredCapabilities
): CandidateModel[] {
  let filtered = candidates;

  if (required.vision) {
    filtered = filtered.filter((candidate) => candidate.capabilities.vision);
  }

  if (required.tools && filtered.some((candidate) => candidate.capabilities.tools)) {
    filtered = filtered.filter((candidate) => candidate.capabilities.tools);
  }

  if (required.json && filtered.some((candidate) => candidate.capabilities.json)) {
    filtered = filtered.filter((candidate) => candidate.capabilities.json);
  }

  return filtered;
}

export function freeCandidatesFromModels(models: OpenRouterModel[]): CandidateModel[] {
  return models.filter(isFreeModel).map(toCandidateModel).sort((left, right) => left.id.localeCompare(right.id));
}

function messageHasImageInput(message: unknown): boolean {
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return false;
  }

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (typeof part !== "object" || part === null || !("type" in part)) {
      return false;
    }
    const type = (part as { type?: unknown }).type;
    return type === "image_url" || type === "input_image";
  });
}
