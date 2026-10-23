import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentProfile } from "../domain/entities/agent-profile.js";
import type { ApprovalPort } from "../domain/ports/approval.port.js";
import type { ApprovalMode } from "../domain/ports/approval.port.js";
import type { ToolDefinition, ToolPort } from "../domain/ports/tool.port.js";
import { ToolCall } from "../domain/value-objects/tool-call.js";
import { InMemoryEventBus } from "../infrastructure/events/in-memory-event-bus.js";
import { ToolRegistry } from "./services/tool-registry.js";
import { ExecuteToolUseCase } from "./usecases/execute-tool.usecase.js";

class NamedTool implements ToolPort {
  constructor(
    private readonly name: string,
    private readonly requiresApproval = false,
    private readonly approvalMode: ApprovalMode = "always",
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: `${this.name} tool`,
      parameters: { type: "object" },
      risk: "shell",
      requiresApproval: this.requiresApproval,
      approvalMode: this.approvalMode,
    };
  }

  async execute(): Promise<string> {
    return `${this.name} ok`;
  }
}

function profile(overrides: {
  tools?: "*" | string[];
  readOnly?: boolean;
  memoryWrite?: boolean;
  canSpawn?: boolean;
} = {}): AgentProfile {
  return AgentProfile.create({
    id: "test-agent",
    name: "Test",
    description: "Test profile",
    systemPrompt: "Do the task.",
    tools: overrides.tools ?? "*",
    skills: "*",
    maxSteps: 4,
    canSpawn: overrides.canSpawn ?? false,
    memoryWrite: overrides.memoryWrite ?? false,
    readOnly: overrides.readOnly ?? true,
    builtIn: false,
  });
}

function harness(): ExecuteToolUseCase {
  const registry = new ToolRegistry();
  for (const name of [
    "echo",
    "write_file",
    "replace_in_file",
    "remember",
    "run_agent",
    "shell",
  ]) {
    registry.register(new NamedTool(name));
  }
  return new ExecuteToolUseCase(registry);
}

describe("ExecuteToolUseCase profile policy", () => {
  it("blocks write, memory, and spawn tools for a read-only profile", async () => {
    const execute = harness();
    const readOnly = profile();

    const write = await execute.execute(
      ToolCall.create("write_file", { path: "a.txt", content: "x" }),
      undefined,
      readOnly,
    );
    const remember = await execute.execute(
      ToolCall.create("remember", { content: "fact" }),
      undefined,
      readOnly,
    );
    const spawn = await execute.execute(
      ToolCall.create("run_agent", { agent: "researcher", task: "x" }),
      undefined,
      readOnly,
    );
    const replace = await execute.execute(
      ToolCall.create("replace_in_file", {
        path: "a.txt",
        old_string: "a",
        new_string: "b",
      }),
      undefined,
      readOnly,
    );
    const shell = await execute.execute(
      ToolCall.create("shell", { command: "npm test" }),
      undefined,
      readOnly,
    );
    const allowed = await execute.execute(
      ToolCall.create("echo", { value: 1 }),
      undefined,
      readOnly,
    );

    assert.equal(write.ok, false);
    assert.match(write.observation, /read-only/);
    assert.equal(remember.ok, false);
    assert.match(remember.observation, /may not write memory/);
    assert.equal(spawn.ok, false);
    assert.match(spawn.observation, /may not spawn/);
    assert.equal(replace.ok, false);
    assert.match(replace.observation, /read-only/);
    assert.equal(shell.ok, false);
    assert.match(shell.observation, /read-only/);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.observation, "echo ok");
  });

  it("enforces the profile allowlist before dispatch", async () => {
    const execute = harness();
    const researcher = profile({ tools: ["echo"], readOnly: false });

    const outcome = await execute.execute(
      ToolCall.create("write_file", { path: "a.txt", content: "x" }),
      undefined,
      researcher,
    );

    assert.equal(outcome.ok, false);
    assert.match(outcome.observation, /not available to the "test-agent" profile/);
  });

  it("allows write, memory, and spawn only when the profile permits them", async () => {
    const execute = harness();
    const assistant = profile({
      tools: "*",
      readOnly: false,
      memoryWrite: true,
      canSpawn: true,
    });

    for (const call of [
      ToolCall.create("write_file", { path: "a.txt", content: "x" }),
      ToolCall.create("remember", { content: "fact" }),
      ToolCall.create("run_agent", { agent: "researcher", task: "x" }),
    ]) {
      const outcome = await execute.execute(call, undefined, assistant);
      assert.equal(outcome.ok, true, outcome.observation);
    }
  });

  it("fails closed when approval is required but unavailable", async () => {
    const registry = new ToolRegistry();
    registry.register(new NamedTool("shell", true));
    const execute = new ExecuteToolUseCase(registry);

    const outcome = await execute.execute(
      ToolCall.create("shell", { command: "npm test" }),
      undefined,
      profile({ tools: "*", readOnly: false }),
    );

    assert.equal(outcome.ok, false);
    assert.match(outcome.observation, /requires human approval/);
  });

  it("runs an approved tool and blocks a denied tool", async () => {
    const registry = new ToolRegistry();
    registry.register(new NamedTool("shell", true));
    let approve = true;
    const approval: ApprovalPort = {
      async request() {
        return { approved: approve, decidedBy: "test" };
      },
    };
    const execute = new ExecuteToolUseCase(registry, approval);
    const call = ToolCall.create("shell", { command: "npm test" });

    const approved = await execute.execute(
      call,
      { sessionId: "s", agentId: "arc", depth: 0, channel: "cli" },
      profile({ tools: "*", readOnly: false }),
    );
    assert.equal(approved.ok, true);

    approve = false;
    const denied = await execute.execute(
      call,
      { sessionId: "s", agentId: "arc", depth: 0, channel: "telegram" },
      profile({ tools: "*", readOnly: false }),
    );
    assert.equal(denied.ok, false);
    assert.match(denied.observation, /Approval denied/);
  });

  it("passes the tool approval mode to the approval boundary", async () => {
    const registry = new ToolRegistry();
    registry.register(new NamedTool("web_fetch", true, "session"));
    let capturedMode: string | undefined;
    const approval: ApprovalPort = {
      async request(request) {
        capturedMode = request.mode;
        return { approved: true, decidedBy: "test" };
      },
    };
    const execute = new ExecuteToolUseCase(registry, approval);

    const outcome = await execute.execute(
      ToolCall.create("web_fetch", { url: "https://example.com" }),
      { sessionId: "s", agentId: "arc", depth: 0, channel: "cli" },
      profile({ tools: "*", readOnly: true }),
    );

    assert.equal(outcome.ok, true, outcome.observation);
    assert.equal(capturedMode, "session");
  });

  it("records approval requests and decisions in the event stream", async () => {
    const registry = new ToolRegistry();
    registry.register(new NamedTool("web_fetch", true, "session"));
    const events = new InMemoryEventBus();
    const seen: string[] = [];
    events.on("*", (event) => seen.push(event.type));
    const approval: ApprovalPort = {
      async request() {
        return { approved: true, decidedBy: "user" };
      },
    };
    const execute = new ExecuteToolUseCase(registry, approval, events);

    await execute.execute(
      ToolCall.create("web_fetch", { url: "https://example.com" }),
      { sessionId: "s", agentId: "arc", depth: 0, channel: "cli" },
      profile({ tools: "*", readOnly: true }),
    );

    assert.deepEqual(
      seen.filter((type) => type.startsWith("approval.")),
      ["approval.requested", "approval.decided"],
    );
  });

  it("returns unknown tools as recoverable observations", async () => {
    const outcome = await harness().execute(
      ToolCall.create("delete_everything", {}),
      undefined,
      profile({ tools: "*", readOnly: false }),
    );

    assert.equal(outcome.ok, false);
    assert.match(outcome.observation, /Unknown tool "delete_everything"/);
  });
});
