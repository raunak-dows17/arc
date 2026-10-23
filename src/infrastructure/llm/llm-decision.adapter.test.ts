import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TextGenerationOptions,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import { LlmDecisionModelAdapter } from "./llm-decision.adapter.js";

function fakeLlm(text: string): TextGenerationPort {
  return {
    async generateText(
      _prompt: string,
      _options?: TextGenerationOptions,
    ): Promise<TextGenerationResult> {
      return {
        text,
        usage: { promptTokens: 7, completionTokens: 3, totalDurationMs: 0 },
      };
    },
  };
}

describe("LlmDecisionModelAdapter", () => {
  it("parses cloud classifier answers and normalizes missing probabilities", async () => {
    const adapter = new LlmDecisionModelAdapter(
      fakeLlm(
        JSON.stringify({
          answers: {
            needs_attention: { type: "noul", noul: 0.9 },
            category: { type: "choice", choice: "urgent" },
            importance: { type: "score", score: 8 },
          },
        }),
      ),
      { provider: "google", model: "gemini-3.5-flash-lite" },
    );

    const result = await adapter.ask({
      state: { subject: "Security alert" },
      questions: {
        needs_attention: { type: "noul", instructions: "attention?" },
        category: {
          type: "choice",
          instructions: "category?",
          criteria: { urgent: "now", newsletter: "later" },
        },
        importance: {
          type: "score",
          instructions: "importance?",
          criteria: ["low", "high"],
        },
      },
    });

    assert.equal(result.model, "google/gemini-3.5-flash-lite");
    assert.deepEqual(result.answers.needs_attention, {
      type: "noul",
      noul: 0.9,
    });
    assert.deepEqual(result.answers.category, {
      type: "choice",
      choice: "urgent",
      probabilities: { urgent: 1 },
      confidence: 1,
    });
    assert.equal(result.usage.inputTokens, 7);
  });

  it("rejects invalid classifier JSON", async () => {
    const adapter = new LlmDecisionModelAdapter(fakeLlm("not json"), {
      provider: "google",
      model: "gemini-3.5-flash-lite",
    });
    await assert.rejects(
      () =>
        adapter.ask({
          state: "x",
          questions: { q: { type: "noul", instructions: "?" } },
        }),
      /invalid JSON/,
    );
  });
});
