import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentSession } from "../domain/entities/agent-session.js";
import { AgentTurnError } from "../domain/errors/agent.errors.js";
import type { LLMPort, LlmRequest } from "../domain/ports/llm.port.js";
import type { ToolDefinition, ToolPort } from "../domain/ports/tool.port.js";
import { AgentDecision } from "../domain/value-objects/agent-decision.js";
import { ToolCall } from "../domain/value-objects/tool-call.js";
import { ExecuteToolUseCase } from "./usecases/execute-tool.usecase.js";
import { RunAgentTurnUseCase } from "./usecases/run-agent-turn.usecase.js";
import { ToolRegistry } from "./services/tool-registry.js";

class ScriptedLlm implements LLMPort {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: AgentDecision[]) {}

  async generateDecision(request: LlmRequest): Promise<AgentDecision> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) {
      throw new Error("ScriptedLlm ran out of decisions.");
    }
    return next;
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
      systemPrompt: "system prompt",
      contextLimits: {
        maxMessages: 10,
        maxContextChars: 10_000,
        maxObservationChars: 1_000,
      },
      maxObservationChars: 1_000,
    },
  );
  return { session, tool, llm, run };
}

describe("RunAgentTurnUseCase", () => {
  it("executes a tool and then returns the final answer", async () => {
    const { session, tool, llm, run } = createHarness([
      toolDecision(1),
      AgentDecision.finish("done", "All finished."),
    ]);

    const answer = await run.execute({ session, prompt: "do the task" });

    assert.equal(answer, "All finished.");
    assert.equal(tool.executions, 1);
    assert.equal(session.status, "completed");
    assert.deepEqual(
      session.messages.map((entry) => entry.role),
      ["user", "tool", "assistant"],
    );
    assert.match(session.messages[1]?.content ?? "", /echo:1/);

    const secondRequest = llm.requests[1];
    assert.ok(secondRequest);
    assert.match(
      secondRequest.messages.at(-1)?.content ?? "",
      /Tool result from echo:\necho:1/,
    );
  });

  it("fails when the step limit is reached", async () => {
    const { session, tool, run } = createHarness(
      [toolDecision(1), toolDecision(2), toolDecision(3)],
      2,
    );

    await assert.rejects(
      run.execute({ session, prompt: "loop forever" }),
      AgentTurnError,
    );
    assert.equal(tool.executions, 2);
    assert.equal(session.status, "failed");
  });

  it("blocks consecutive duplicate tool calls", async () => {
    const { session, tool, run } = createHarness([
      toolDecision(1),
      toolDecision(1),
      AgentDecision.finish("done", "Recovered."),
    ]);

    const answer = await run.execute({ session, prompt: "try again" });

    assert.equal(answer, "Recovered.");
    assert.equal(tool.executions, 1);
    assert.match(
      session.messages.find((entry) => entry.role === "tool" && entry.content.includes("Duplicate"))?.content ?? "",
      /Duplicate call blocked/,
    );
  });

  it("stops before calling the model when already aborted", async () => {
    const { session, llm, run } = createHarness([
      AgentDecision.finish("done", "never"),
    ]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      run.execute({
        session,
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
