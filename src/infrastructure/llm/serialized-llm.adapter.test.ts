import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import { AgentDecision } from "../../domain/value-objects/agent-decision.js";
import { SerializedLlmAdapter } from "./serialized-llm.adapter.js";

class SlowLlm implements LLMPort, TextGenerationPort {
  active = 0;
  maxActive = 0;
  calls = 0;

  private async wait(): Promise<void> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
  }

  async generateDecision(_request: LlmRequest): Promise<LlmDecisionResult> {
    await this.wait();
    return {
      decision: AgentDecision.finish("", "ok"),
      usage: { promptTokens: 1, completionTokens: 1, totalDurationMs: 1 },
    };
  }

  async generateText(): Promise<TextGenerationResult> {
    await this.wait();
    return {
      text: "summary",
      usage: { promptTokens: 1, completionTokens: 1, totalDurationMs: 1 },
    };
  }
}

function request(): LlmRequest {
  return { systemPrompt: "system", messages: [], tools: [] };
}

describe("SerializedLlmAdapter", () => {
  it("never runs two model requests at once", async () => {
    const inner = new SlowLlm();
    const llm = new SerializedLlmAdapter(inner);

    await Promise.all([
      llm.generateDecision(request()),
      llm.generateText("compress"),
      llm.generateDecision(request()),
    ]);

    assert.equal(inner.calls, 3);
    assert.equal(inner.maxActive, 1);
  });

  it("does not call the model when a queued request was aborted", async () => {
    const inner = new SlowLlm();
    const llm = new SerializedLlmAdapter(inner);

    const first = llm.generateText("first");
    const controller = new AbortController();
    controller.abort();
    const second = llm.generateDecision({
      ...request(),
      signal: controller.signal,
    });

    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    assert.equal(inner.calls, 1);
  });
});
