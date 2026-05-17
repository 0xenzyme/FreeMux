import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("freemux status prints discovered candidate count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freemux-cli-"));
  const statePath = join(dir, "state.json");

  try {
    await writeFile(statePath, JSON.stringify({
      version: 1,
      updatedAt: "2026-05-05T00:00:01.000Z",
      lastSelectedModel: "alpha/free",
      lastCandidateCount: 3,
      lastDiscoveryAt: "2026-05-05T00:00:00.000Z",
      models: {
        "alpha/free": {
          successCount: 1,
          failureCount: 0,
          lastLatencyMs: 12
        }
      }
    }));

    const result = spawnSync(process.execPath, ["dist/cli.js", "status"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FREEMUX_STATE_PATH: statePath
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Last discovered candidates: 3/);
    assert.match(result.stdout, /Last discovery: 2026-05-05T00:00:00\.000Z/);
    assert.match(result.stdout, /alpha\/free ok=1 fail=0 latency=12ms/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freemux commands read OPENROUTER_API_KEY from .env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freemux-cli-env-"));

  try {
    await writeFile(join(dir, ".env"), [
      "OPENROUTER_API_KEY=from-dotenv",
      "OPENROUTER_BASE_URL=http://127.0.0.1:9",
      "FREEMUX_REQUEST_TIMEOUT_MS=100"
    ].join("\n"));

    const result = spawnSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "models"], {
      cwd: dir,
      env: {
        PATH: process.env.PATH || ""
      },
      encoding: "utf8"
    });

    assert.notEqual(result.stderr.trim(), "freemux: OPENROUTER_API_KEY is required for this command.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
