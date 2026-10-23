import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentSession } from "../domain/entities/agent-session.js";
import type {
  TextGenerationPort,
  TextGenerationResult,
} from "../domain/ports/llm.port.js";
import { CompactSessionUseCase } from "./usecases/compact-session.usecase.js";

class FakeTextLlm implements TextGenerationPort {
  calls = 0;
  constructor(private readonly fail = false) {}

  async generateText(): Promise<TextGenerationResult> {
    this.calls += 1;
    if (this.fail) {
      throw new Error("model unavailable");
    }
    return {
      text: "The user planned the agent and decided to use Markdown memory.",
      usage: { promptTokens: 100, completionTokens: 20, totalDurationMs: 10 },
    };
  }
}

function sessionWithMessages(): AgentSession {
  const session = AgentSession.create("s1");
  for (let index = 0; index < 10; index += 1) {
    if (index % 2 === 0) {
      session.addUserMessage(`message ${index}`);
    } else {
      session.addAssistantMessage(`answer ${index}`);
    }
  }
  return session;
}

describe("CompactSessionUseCase", () => {
  it("summarizes older messages and keeps the recent window verbatim", async () => {
    const llm = new FakeTextLlm();
    const compact = new CompactSessionUseCase(llm, {
      thresholdChars: 10,
      keepRecentMessages: 3,
    });
    const session = sessionWithMessages();

    const result = await compact.force(session);

    assert.equal(result.compacted, true);
    assert.equal(result.messagesSummarized, 7);
    assert.equal(session.summary?.throughMessageCount, 7);
    assert.match(session.summary?.text ?? "", /Markdown memory/);
    assert.equal(session.workingMessages.length, 3);
    assert.equal(session.usage.modelCalls, 1);
    assert.equal(llm.calls, 1);
  });

  it("does nothing below the threshold unless forced", async () => {
    const llm = new FakeTextLlm();
    const compact = new CompactSessionUseCase(llm, {
      thresholdChars: 1_000_000,
      keepRecentMessages: 3,
    });
    const session = sessionWithMessages();

    const result = await compact.maybeCompact(session);
    assert.equal(result.compacted, false);
    assert.equal(session.summary, null);
    assert.equal(llm.calls, 0);
  });

  it("leaves history intact when the summarizer fails", async () => {
    const compact = new CompactSessionUseCase(new FakeTextLlm(true), {
      thresholdChars: 10,
      keepRecentMessages: 3,
    });
    const session = sessionWithMessages();

    const result = await compact.force(session);
    assert.equal(result.compacted, false);
    assert.equal(session.summary, null);
  });

  it("propagates cancellation", async () => {
    const compact = new CompactSessionUseCase(new FakeTextLlm(), {
      thresholdChars: 10,
      keepRecentMessages: 3,
    });
    const session = sessionWithMessages();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      compact.force(session, controller.signal),
      (error: unknown) =>
        error instanceof Error && error.name === "AbortError",
    );
  });
});
