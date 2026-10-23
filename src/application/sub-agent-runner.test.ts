import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { AgentProfile } from "../domain/entities/agent-profile.js";
import { AgentSession } from "../domain/entities/agent-session.js";
import { AgentTurnError, SubAgentError } from "../domain/errors/agent.errors.js";
import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
} from "../domain/ports/llm.port.js";
import type { ToolDefinition, ToolPort } from "../domain/ports/tool.port.js";
import { AgentDecision } from "../domain/value-objects/agent-decision.js";
import { ToolCall } from "../domain/value-objects/tool-call.js";
import type { ContextAssembler } from "./services/context-assembler.js";
import { buildContextMessages } from "./services/context-builder.js";
import { ToolRegistry } from "./services/tool-registry.js";
import { ExecuteToolUseCase } from "./usecases/execute-tool.usecase.js";
import { SubAgentRunner } from "./usecases/sub-agent-runner.js";
import { JsonSessionStore } from "../infrastructure/persistence/json-session.store.js";
import { JsonSubAgentRepository } from "../infrastructure/persistence/json-sub-agent.repository.js";
import { MarkdownAgentProfileRepository } from "../infrastructure/profiles/markdown-profile.repository.js";
import { InMemoryEventBus } from "../infrastructure/events/in-memory-event-bus.js";

class ScriptedLlm implements LLMPort {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: AgentDecision[]) {}

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) {
      throw new AgentTurnError("No scripted decision left.");
    }
    return {
      decision: next,
      usage: { promptTokens: 10, completionTokens: 5, totalDurationMs: 1 },
    };
  }
}

class EchoTool implements ToolPort {
  getDefinition(): ToolDefinition {
    return {
      name: "echo",
      description: "Echo",
      parameters: { type: "object" },
    };
  }

  async execute(): Promise<string> {
    return "child observation";
  }
}

function makeAssembler(registry: ToolRegistry): ContextAssembler {
  return {
    assemble: async (session: AgentSession, profile: AgentProfile) => ({
      systemPrompt: `profile: ${profile.id}`,
      messages: buildContextMessages(session.workingMessages, {
        maxMessages: 10,
        maxContextChars: 10_000,
        maxObservationChars: 1_000,
      }),
      tools: registry
        .getDefinitions()
        .filter((tool) => profile.allowsTool(tool.name)),
    }),
    estimate: async () => ({
      systemChars: 10,
      historyChars: 0,
      messages: 0,
    }),
  } as unknown as ContextAssembler;
}

describe("SubAgentRunner", () => {
  let base: string;
  let sessions: JsonSessionStore;
  let runs: JsonSubAgentRepository;
  let profiles: MarkdownAgentProfileRepository;
  let registry: ToolRegistry;
  let llm: ScriptedLlm;
  let runner: SubAgentRunner;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-subagent-"));
    await writeFile(
      path.join(base, "helper.md"),
      [
        "---",
        "name: helper",
        "description: Tool-using helper",
        "tools: [echo]",
        "skills: []",
        "maxSteps: 4",
        "canSpawn: false",
        "---",
        "",
        "Use the echo tool once, then answer.",
      ].join("\n"),
      "utf8",
    );

    sessions = new JsonSessionStore(path.join(base, "sessions"));
    runs = new JsonSubAgentRepository(path.join(base, "runs"));
    profiles = new MarkdownAgentProfileRepository(base);
    await profiles.reload();
    registry = new ToolRegistry();
    registry.register(new EchoTool());

    llm = new ScriptedLlm([
      AgentDecision.useTool("", ToolCall.create("echo", { value: 1 })),
      AgentDecision.finish("", "Child summary."),
    ]);

    const executeTool = new ExecuteToolUseCase(registry);
    const assembler = makeAssembler(registry);

    runner = new SubAgentRunner(
      {
        profiles,
        sessions,
        runs,
        registry,
        executeTool,
        llm,
        assembler,
        events: new InMemoryEventBus(),
      },
      {
        maxDepth: 1,
        maxSteps: 4,
        maxRunMs: 5_000,
        maxObservationChars: 1_000,
      },
    );
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("runs an isolated child, persists its transcript, and returns a summary", async () => {
    const result = await runner.run({
      parentSessionId: "parent-1",
      parentAgentId: "assistant",
      parentDepth: 0,
      agentId: "helper",
      task: "Do a small task.",
    });

    assert.equal(result.status, "completed");
    assert.equal(result.summary, "Child summary.");
    assert.equal(result.steps, 1);

    const child = await sessions.load(result.childSessionId);
    assert.ok(child);
    assert.equal(child.agentId, "helper");
    assert.equal(child.parentId, "parent-1");
    assert.equal(child.depth, 1);
    assert.equal(child.status, "completed");
    assert.deepEqual(
      child.messages.map((message) => message.role),
      ["user", "tool", "assistant"],
    );

    const run = await runs.load(result.runId);
    assert.equal(run?.status, "completed");
    assert.equal(run?.parentSessionId, "parent-1");
    assert.equal(run?.steps, 1);

    assert.equal(llm.requests.length, 2);
    assert.deepEqual(
      llm.requests[0]?.tools.map((tool) => tool.name),
      ["echo"],
    );
  });

  it("rejects profiles that are allowed to spawn", async () => {
    await assert.rejects(
      runner.run({
        parentSessionId: "parent-2",
        parentAgentId: "assistant",
        parentDepth: 0,
        agentId: "assistant",
        task: "Recurse.",
      }),
      SubAgentError,
    );
  });

  it("enforces the depth limit", async () => {
    await assert.rejects(
      runner.run({
        parentSessionId: "parent-3",
        parentAgentId: "helper",
        parentDepth: 1,
        agentId: "helper",
        task: "Too deep.",
      }),
      SubAgentError,
    );
  });
});
