import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("prefers ARC_WORKSPACE and falls back to legacy workspace names", () => {
    const preferred = loadConfig({
      ARC_HOME: "./.arc",
      ARC_WORKSPACE: "./workspace",
      WORKSPACE_DIR: "./legacy-workspace",
      SANDBOX_DIR: "./legacy",
    } as NodeJS.ProcessEnv);
    assert.equal(preferred.workspaceDir, path.resolve("./workspace"));

    const legacy = loadConfig({
      ARC_HOME: "./.arc",
      SANDBOX_DIR: "./legacy",
    } as NodeJS.ProcessEnv);
    assert.equal(legacy.workspaceDir, path.resolve("./legacy"));
    assert.equal(legacy.sandboxDir, legacy.workspaceDir);
  });

  it("derives private state paths from ARC_HOME", () => {
    const config = loadConfig({
      ARC_HOME: "./private-state",
      ARC_WORKSPACE: "./workspace",
    } as NodeJS.ProcessEnv);

    assert.equal(config.arcHome, path.resolve("./private-state"));
    assert.equal(config.sessionDir, path.resolve("./private-state/sessions"));
    assert.equal(config.memoryDir, path.resolve("./private-state/memory"));
    assert.equal(
      config.auditLogPath,
      path.resolve("./private-state/audit.jsonl"),
    );
    assert.equal(config.agent.compactAtChars, 11_200);
  });

  it("supports legacy AGENT_HOME and AGENT_PROFILE during migration", () => {
    const config = loadConfig({
      AGENT_HOME: "./.agent-home",
      AGENT_PROFILE: "assistant",
      WORKSPACE_DIR: "./workspace",
    } as NodeJS.ProcessEnv);

    assert.equal(config.arcHome, path.resolve("./.agent-home"));
    assert.equal(config.agent.defaultProfileId, "assistant");
  });

  it("uses ARC-prefixed model configuration and falls back to Ollama names", () => {
    const config = loadConfig({
      ARC_HOME: "./.arc",
      ARC_WORKSPACE: "./workspace",
      ARC_MODEL: "qwen3:8b",
      ARC_CODING_MODEL: "qwen2.5-coder:7b",
      ARC_DECISION_MODEL: "tev1:0.8b",
      ARC_NUM_CTX: "4096",
    } as NodeJS.ProcessEnv);

    assert.equal(config.ollama.model, "qwen3:8b");
    assert.equal(config.ollama.codingModel, "qwen2.5-coder:7b");
    assert.equal(config.ollama.decisionModel, "tev1:0.8b");
    assert.equal(config.ollama.numCtx, 4096);

    const legacy = loadConfig({
      AGENT_HOME: "./.agent-home",
      WORKSPACE_DIR: "./workspace",
      OLLAMA_MODEL: "qwen3:8b",
      OLLAMA_NUM_CTX: "2048",
    } as NodeJS.ProcessEnv);

    assert.equal(legacy.ollama.model, "qwen3:8b");
    assert.equal(legacy.ollama.numCtx, 2048);
  });

  it("rejects an ARC_HOME inside the workspace", () => {
    assert.throws(
      () =>
        loadConfig({
          ARC_HOME: "./workspace/.arc",
          ARC_WORKSPACE: "./workspace",
        } as NodeJS.ProcessEnv),
      /ARC_HOME must be outside ARC_WORKSPACE/,
    );
  });
});
