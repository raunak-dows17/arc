import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentProfile } from "../domain/entities/agent-profile.js";
import { AgentSession } from "../domain/entities/agent-session.js";
import { AgentTurnError } from "../domain/errors/agent.errors.js";
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
import { ExecuteToolUseCase } from "./usecases/execute-tool.usecase.js";
import { RunAgentTurnUseCase } from "./usecases/run-agent-turn.usecase.js";
import { ToolRegistry } from "./services/tool-registry.js";
import type { ModelRouter } from "./services/model-router.js";

class ScriptedLlm implements LLMPort {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: AgentDecision[]) {}

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) {
      throw new Error("ScriptedLlm ran out of decisions.");
    }
    return {
      decision: next,
      usage: { promptTokens: 10, completionTokens: 5, totalDurationMs: 1 },
    };
  }
}

class EchoTool implements ToolPort {
  executions = 0;

  getDefinition(): ToolDefinition {
    return {
      name: "echo",
      description: "Echo the provided value.",
      parameters: { type: "object" },
    };
  }

  async execute(args: unknown): Promise<string> {
    this.executions += 1;
    const value = (args as { value?: unknown }).value;
    return `echo:${String(value)}`;
  }
}

function toolDecision(value: number): AgentDecision {
  return AgentDecision.useTool("echo", ToolCall.create("echo", { value }));
}

function assistantProfile(maxSteps = 8): AgentProfile {
  return AgentProfile.create({
    id: "assistant",
    name: "Assistant",
    description: "test",
    systemPrompt: "system prompt",
    tools: "*",
    skills: "*",
    maxSteps,
    canSpawn: true,
    memoryWrite: true,
    readOnly: false,
    builtIn: true,
  });
}

function createAssembler(registry: ToolRegistry): ContextAssembler {
  return {
    assemble: async (session: AgentSession) => ({
      systemPrompt: "system prompt",
      messages: buildContextMessages(session.workingMessages, {
        maxMessages: 10,
        maxContextChars: 10_000,
        maxObservationChars: 1_000,
      }),
      tools: registry.getDefinitions(),
    }),
    estimate: async () => ({
      systemChars: 13,
      historyChars: 0,
      messages: 0,
    }),
  } as unknown as ContextAssembler;
}

function createHarness(script: AgentDecision[], maxSteps = 4) {
  const session = AgentSession.create("test-session");
  const tool = new EchoTool();
  const registry = new ToolRegistry();
  registry.register(tool);
  const llm = new ScriptedLlm(script);
  const run = new RunAgentTurnUseCase(
    llm,
    registry,
    new ExecuteToolUseCase(registry),
    {
      maxSteps,
      maxObservationChars: 1_000,
      maxSubAgentsPerTurn: 0,
      assembler: createAssembler(registry),
    },
  );
  return { session, tool, llm, run, profile: assistantProfile(maxSteps) };
}

describe("RunAgentTurnUseCase", () => {
  it("executes a tool and then returns the final answer", async () => {
    const { session, tool, llm, run, profile } = createHarness([
      toolDecision(1),
      AgentDecision.finish("done", "All finished."),
    ]);

    const answer = await run.execute({
      session,
      profile,
      prompt: "do the task",
    });

    assert.equal(answer, "All finished.");
    assert.equal(tool.executions, 1);
    assert.equal(session.status, "completed");
    assert.deepEqual(
      session.messages.map((entry) => entry.role),
      ["user", "tool", "assistant"],
    );
    assert.match(session.messages[1]?.content ?? "", /echo:1/);
    assert.equal(session.usage.modelCalls, 2);
    assert.equal(session.usage.promptTokens, 20);

    const secondRequest = llm.requests[1];
    assert.ok(secondRequest);
    assert.match(
      secondRequest.messages.at(-1)?.content ?? "",
      /Tool result from echo:\necho:1/,
    );
  });

  it("fails when the step limit is reached", async () => {
    const { session, tool, run, profile } = createHarness(
      [toolDecision(1), toolDecision(2), toolDecision(3)],
      2,
    );

    await assert.rejects(
      run.execute({ session, profile, prompt: "loop forever" }),
      AgentTurnError,
    );
    assert.equal(tool.executions, 2);
    assert.equal(session.status, "failed");
  });

  it("blocks consecutive duplicate tool calls", async () => {
    const { session, tool, run, profile } = createHarness([
      toolDecision(1),
      toolDecision(1),
      AgentDecision.finish("done", "Recovered."),
    ]);

    const answer = await run.execute({
      session,
      profile,
      prompt: "try again",
    });

    assert.equal(answer, "Recovered.");
    assert.equal(tool.executions, 1);
    assert.match(
      session.messages.find(
        (entry) =>
          entry.role === "tool" && entry.content.includes("Duplicate"),
      )?.content ?? "",
      /Duplicate call blocked/,
    );
  });

  it("blocks a repeated call even after a different call", async () => {
    const { session, tool, run, profile } = createHarness([
      toolDecision(1),
      toolDecision(2),
      toolDecision(1),
      AgentDecision.finish("done", "Recovered."),
    ]);

    const answer = await run.execute({
      session,
      profile,
      prompt: "try again",
    });

    assert.equal(answer, "Recovered.");
    assert.equal(tool.executions, 2);
    assert.match(
      session.messages.find(
        (entry) =>
          entry.role === "tool" && entry.content.includes("Duplicate"),
      )?.content ?? "",
      /Duplicate call blocked/,
    );
  });

  it("fails fast when the model keeps repeating the same call", async () => {
    const { session, tool, run, profile } = createHarness(
      [toolDecision(1), toolDecision(1), toolDecision(1), toolDecision(1)],
      6,
    );

    await assert.rejects(
      run.execute({ session, profile, prompt: "loop forever" }),
      /repeated the same/,
    );
    assert.equal(tool.executions, 1);
    assert.equal(session.status, "failed");
  });

  it("falls back to the next orchestrated model when the primary fails", async () => {
    const session = AgentSession.create("fallback-session");
    const tool = new EchoTool();
    const registry = new ToolRegistry();
    registry.register(tool);
    const requests: LlmRequest[] = [];
    const llm: LLMPort = {
      async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
        requests.push(request);
        if (request.provider === "ollama") {
          throw new Error("local runtime unavailable");
        }
        return {
          decision: AgentDecision.finish("done", "Cloud answered."),
          usage: { promptTokens: 1, completionTokens: 1, totalDurationMs: 1 },
        };
      },
    };
    const modelRouter = {
      planForProfile: () => ({
        primary: { provider: "ollama", model: "qwen3:8b" },
        fallbacks: [{ provider: "google", model: "gemini-3.6-flash" }],
        reason: "test",
        local: true,
      }),
    } as unknown as ModelRouter;
    const run = new RunAgentTurnUseCase(
      llm,
      registry,
      new ExecuteToolUseCase(registry),
      {
        maxSteps: 1,
        maxObservationChars: 1_000,
        maxSubAgentsPerTurn: 0,
        assembler: createAssembler(registry),
        modelRouter,
      },
    );

    const answer = await run.execute({
      session,
      profile: assistantProfile(1),
      prompt: "use the fallback",
    });

    assert.equal(answer, "Cloud answered.");
    assert.deepEqual(
      requests.map((request) => `${request.provider}/${request.model}`),
      ["ollama/qwen3:8b", "google/gemini-3.6-flash"],
    );
  });

  it("stops before calling the model when already aborted", async () => {
    const { session, llm, run, profile } = createHarness([
      AgentDecision.finish("done", "never"),
    ]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      run.execute({
        session,
        profile,
        prompt: "cancelled",
        signal: controller.signal,
      }),
      (error: unknown) =>
        error instanceof Error && error.name === "AbortError",
    );

    assert.equal(llm.requests.length, 0);
    assert.equal(session.status, "failed");
  });
});
