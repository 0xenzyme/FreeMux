import { freeCandidatesFromModels } from "./models.js";
import type { CandidateModel } from "./types.js";
import type { OpenRouterClient } from "./openrouter.js";

export class ModelCatalog {
  private readonly client: OpenRouterClient;
  private readonly ttlMs: number;
  private cachedAt?: number;
  private cachedCandidates: CandidateModel[] = [];

  constructor(client: OpenRouterClient, ttlMs: number) {
    this.client = client;
    this.ttlMs = ttlMs;
  }

  async getFreeCandidates(forceRefresh = false): Promise<CandidateModel[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedAt !== undefined && now - this.cachedAt < this.ttlMs) {
      return this.cachedCandidates;
    }

    const response = await this.client.fetchModels();
    this.cachedCandidates = freeCandidatesFromModels(response.data);
    this.cachedAt = now;
    return this.cachedCandidates;
  }
}
