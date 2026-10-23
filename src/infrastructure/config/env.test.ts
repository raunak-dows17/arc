import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("prefers WORKSPACE_DIR and falls back to SANDBOX_DIR", () => {
    const preferred = loadConfig({
      AGENT_HOME: "./.agent-home",
      WORKSPACE_DIR: "./workspace",
      SANDBOX_DIR: "./legacy",
    } as NodeJS.ProcessEnv);
    assert.equal(preferred.workspaceDir, path.resolve("./workspace"));

    const legacy = loadConfig({
      AGENT_HOME: "./.agent-home",
      SANDBOX_DIR: "./legacy",
    } as NodeJS.ProcessEnv);
    assert.equal(legacy.workspaceDir, path.resolve("./legacy"));
    assert.equal(legacy.sandboxDir, legacy.workspaceDir);
  });

  it("derives private state paths from AGENT_HOME", () => {
    const config = loadConfig({
      AGENT_HOME: "./private-state",
      WORKSPACE_DIR: "./workspace",
    } as NodeJS.ProcessEnv);

    assert.equal(config.sessionDir, path.resolve("./private-state/sessions"));
    assert.equal(config.memoryDir, path.resolve("./private-state/memory"));
    assert.equal(config.auditLogPath, path.resolve("./private-state/audit.jsonl"));
    assert.equal(config.agent.compactAtChars, 11_200);
  });

  it("rejects an AGENT_HOME inside the workspace", () => {
    assert.throws(
      () =>
        loadConfig({
          AGENT_HOME: "./workspace/.agent-home",
          WORKSPACE_DIR: "./workspace",
        } as NodeJS.ProcessEnv),
      /AGENT_HOME must be outside WORKSPACE_DIR/,
    );
  });
});
