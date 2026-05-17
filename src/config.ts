import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FreeMuxConfig } from "./types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4117;
const DEFAULT_MODEL_ALIAS = "freemodel";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL_LIST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export function defaultStatePath(): string {
  return join(homedir(), ".freemux", "state.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): FreeMuxConfig {
  const mergedEnv = {
    ...loadDotEnv(cwd),
    ...env
  };

  return {
    host: mergedEnv.FREEMUX_HOST || DEFAULT_HOST,
    port: parseInteger(mergedEnv.FREEMUX_PORT, DEFAULT_PORT, "FREEMUX_PORT"),
    statePath: mergedEnv.FREEMUX_STATE_PATH || defaultStatePath(),
    modelAlias: mergedEnv.FREEMUX_MODEL_ALIAS || DEFAULT_MODEL_ALIAS,
    openrouterApiKey: mergedEnv.OPENROUTER_API_KEY,
    openrouterBaseUrl: trimTrailingSlash(mergedEnv.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL),
    modelListTtlMs: parseInteger(mergedEnv.FREEMUX_MODEL_LIST_TTL_MS, DEFAULT_MODEL_LIST_TTL_MS, "FREEMUX_MODEL_LIST_TTL_MS"),
    maxAttempts: parseInteger(mergedEnv.FREEMUX_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, "FREEMUX_MAX_ATTEMPTS"),
    requestTimeoutMs: parseInteger(mergedEnv.FREEMUX_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, "FREEMUX_REQUEST_TIMEOUT_MS")
  };
}

export function requireOpenRouterApiKey(config: FreeMuxConfig): string {
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for this command.");
  }
  return config.openrouterApiKey;
}

function parseInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadDotEnv(cwd = process.cwd()): Record<string, string> {
  const path = resolve(cwd, ".env");
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }

  return parseDotEnv(raw);
}

export function parseDotEnv(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    parsed[key] = parseDotEnvValue(normalized.slice(equalsIndex + 1).trim());
  }

  return parsed;
}

function parseDotEnvValue(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  const commentIndex = value.search(/\s#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
