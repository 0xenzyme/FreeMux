import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, loadDotEnv, parseDotEnv } from "../dist/config.js";

test("parseDotEnv handles comments, export, quotes, and inline comments", () => {
  assert.deepEqual(parseDotEnv(`
# ignored
OPENROUTER_API_KEY=from-env-file
export FREEMUX_PORT=4118
FREEMUX_HOST="0.0.0.0"
FREEMUX_MODEL_ALIAS='freecode'
FREEMUX_STATE_PATH=./state.json # local state
INVALID LINE
1_BAD=ignored
`), {
    OPENROUTER_API_KEY: "from-env-file",
    FREEMUX_PORT: "4118",
    FREEMUX_HOST: "0.0.0.0",
    FREEMUX_MODEL_ALIAS: "freecode",
    FREEMUX_STATE_PATH: "./state.json"
  });
});

test("loadConfig reads .env and lets real environment override it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freemux-config-"));

  try {
    await writeFile(join(dir, ".env"), [
      "OPENROUTER_API_KEY=from-dotenv",
      "FREEMUX_PORT=4118",
      "FREEMUX_MODEL_ALIAS=dotenvmodel"
    ].join("\n"));

    const config = loadConfig({ FREEMUX_PORT: "4119" }, dir);
    assert.equal(config.openrouterApiKey, "from-dotenv");
    assert.equal(config.port, 4119);
    assert.equal(config.modelAlias, "dotenvmodel");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDotEnv returns empty object when .env is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freemux-config-empty-"));

  try {
    assert.deepEqual(loadDotEnv(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
