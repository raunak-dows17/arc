import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../infrastructure/config/env.js";
import { runDoctor } from "../infrastructure/cli/doctor.js";
import { InMemorySecretStore } from "../infrastructure/secrets/in-memory.secret-store.js";

function tagsResponse(models: string[]): Response {
  return new Response(
    JSON.stringify({ models: models.map((name) => ({ name })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("runDoctor", () => {
  let base: string;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "arc-doctor-"));
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("reports a healthy Windows runtime shape", async () => {
    const config = loadConfig({
      ARC_HOME: path.join(base, "home"),
      ARC_WORKSPACE: path.join(base, "workspace"),
    } as NodeJS.ProcessEnv);

    const report = await runDoctor(config, {
      platform: "win32",
      nodeVersion: "22.0.0",
      totalMemory: 16 * 1024 ** 3,
      freeMemory: 8 * 1024 ** 3,
      secretStore: new InMemorySecretStore(),
      fetchImpl: async () =>
        tagsResponse([
          "qwen3:8b",
          "qwen2.5-coder:7b",
          "tev1:0.8b",
        ]),
    });

    assert.equal(report.ok, true);
    assert.equal(
      report.checks.find((check) => check.id === "keyring")?.status,
      "ok",
    );
    assert.equal(
      report.checks.find((check) => check.id === "models")?.status,
      "ok",
    );
  });

  it("warns when a routed model is missing", async () => {
    const config = loadConfig({
      ARC_HOME: path.join(base, "home-missing"),
      ARC_WORKSPACE: path.join(base, "workspace-missing"),
    } as NodeJS.ProcessEnv);

    const report = await runDoctor(config, {
      platform: "win32",
      nodeVersion: "22.0.0",
      totalMemory: 16 * 1024 ** 3,
      freeMemory: 8 * 1024 ** 3,
      secretStore: new InMemorySecretStore(),
      fetchImpl: async () => tagsResponse(["qwen3:8b"]),
    });

    assert.equal(
      report.checks.find((check) => check.id === "models")?.status,
      "warn",
    );
  });

  it("fails when Ollama is unreachable", async () => {
    const config = loadConfig({
      ARC_HOME: path.join(base, "home-offline"),
      ARC_WORKSPACE: path.join(base, "workspace-offline"),
    } as NodeJS.ProcessEnv);

    const report = await runDoctor(config, {
      platform: "win32",
      nodeVersion: "22.0.0",
      totalMemory: 16 * 1024 ** 3,
      freeMemory: 8 * 1024 ** 3,
      secretStore: new InMemorySecretStore(),
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });

    assert.equal(report.ok, false);
    assert.equal(
      report.checks.find((check) => check.id === "ollama")?.status,
      "fail",
    );
  });
});
