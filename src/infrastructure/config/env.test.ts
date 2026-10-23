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

  it("configures read-only email and Telegram chat", () => {
    const config = loadConfig({
      ARC_HOME: "./.arc",
      ARC_WORKSPACE: "./workspace",
      ARC_EMAIL_ENABLED: "true",
      ARC_EMAIL_ADDRESS: "raunak@example.com",
      ARC_EMAIL_POLL_INTERVAL_MS: "120000",
      ARC_EMAIL_MAX_MESSAGES: "5",
      ARC_EMAIL_TRIAGE_THRESHOLD: "0.7",
      ARC_TELEGRAM_ENABLED: "true",
      ARC_TELEGRAM_ALLOWED_CHAT_IDS: "123, -456",
    } as NodeJS.ProcessEnv);

    assert.equal(config.email.enabled, true);
    assert.equal(config.email.address, "raunak@example.com");
    assert.equal(config.email.pollIntervalMs, 120_000);
    assert.equal(config.email.maxMessages, 5);
    assert.equal(config.email.triageThreshold, 0.7);
    assert.equal(config.telegram.enabled, true);
    assert.deepEqual(config.telegram.allowedChatIds, ["123", "-456"]);
    assert.equal(config.telegram.notifyChatId, "123");
  });

  it("rejects incomplete email and Telegram configuration", () => {
    assert.throws(
      () =>
        loadConfig({
          ARC_HOME: "./.arc",
          ARC_WORKSPACE: "./workspace",
          ARC_EMAIL_ENABLED: "true",
        } as NodeJS.ProcessEnv),
      /ARC_EMAIL_ADDRESS is required/,
    );
    assert.throws(
      () =>
        loadConfig({
          ARC_HOME: "./.arc",
          ARC_WORKSPACE: "./workspace",
          ARC_TELEGRAM_ENABLED: "true",
        } as NodeJS.ProcessEnv),
      /ARC_TELEGRAM_ALLOWED_CHAT_IDS/,
    );
    assert.throws(
      () =>
        loadConfig({
          ARC_HOME: "./.arc",
          ARC_WORKSPACE: "./workspace",
          ARC_TELEGRAM_ALLOWED_CHAT_IDS: "not-a-number",
        } as NodeJS.ProcessEnv),
      /Invalid Telegram chat id/,
    );
  });

  it("configures bounded web and shell tools", () => {
    const defaults = loadConfig({
      ARC_HOME: "./.arc",
      ARC_WORKSPACE: "./workspace",
    } as NodeJS.ProcessEnv);
    assert.equal(defaults.web.maxResults, 8);
    assert.equal(defaults.web.maxChars, 20_000);
    assert.equal(defaults.shell.timeoutMs, 60_000);

    const configured = loadConfig({
      ARC_HOME: "./.arc",
      ARC_WORKSPACE: "./workspace",
      ARC_WEB_SEARCH_URL: "https://search.example.test/v1",
      ARC_WEB_FETCH_TIMEOUT_MS: "5000",
      ARC_WEB_MAX_RESULTS: "3",
      ARC_SHELL_TIMEOUT_MS: "15000",
      ARC_SHELL_MAX_OUTPUT_BYTES: "8000",
    } as NodeJS.ProcessEnv);

    assert.equal(configured.web.searchUrl, "https://search.example.test/v1");
    assert.equal(configured.web.fetchTimeoutMs, 5_000);
    assert.equal(configured.web.maxResults, 3);
    assert.equal(configured.shell.timeoutMs, 15_000);
    assert.equal(configured.shell.maxOutputBytes, 8_000);
  });
});
