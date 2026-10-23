import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ShellTool } from "./shell.tool.js";

describe("ShellTool", () => {
  let base: string;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "arc-shell-"));
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("captures stdout and the exit status", async () => {
    const tool = new ShellTool({ cwd: base });
    const result = await tool.execute({
      command: "node -e \"process.stdout.write('hello')\"",
    });

    assert.match(result, /status: exit code 0/);
    assert.match(result, /hello/);
  });

  it("returns non-zero exit codes as observations", async () => {
    const tool = new ShellTool({ cwd: base });
    const result = await tool.execute({
      command: "node -e \"process.exit(3)\"",
    });

    assert.match(result, /status: exit code 3/);
  });

  it("times out and terminates the command", async () => {
    const tool = new ShellTool({ cwd: base, timeoutMs: 2_000 });
    const result = await tool.execute({
      command: "node -e \"setTimeout(() => {}, 5000)\"",
      timeout_seconds: 1,
    });

    assert.match(result, /timed out/);
    assert.match(result, /terminated/);
  });

  it("truncates large output", async () => {
    const tool = new ShellTool({ cwd: base, maxOutputBytes: 100 });
    const result = await tool.execute({
      command: "node -e \"process.stdout.write('x'.repeat(1000))\"",
    });

    assert.match(result, /output truncated/);
    assert.equal(result.includes("x".repeat(101)), false);
  });

  it("declares every shell call as approval-gated", () => {
    const definition = new ShellTool({ cwd: base }).getDefinition();
    assert.equal(definition.requiresApproval, true);
    assert.equal(definition.approvalMode, "always");
    assert.equal(definition.risk, "shell");
  });
});
