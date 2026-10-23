import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionModelError } from "../../domain/errors/agent.errors.js";
import type { DecisionRequest } from "../../domain/ports/decision-model.port.js";
import { OllamaDecisionAdapter } from "./ollama-decision.adapter.js";

const config = {
  baseUrl: "http://127.0.0.1:11434",
  model: "tev1:0.8b",
  keepAlive: "5m",
  timeoutMs: 2_000,
};

function request(): DecisionRequest {
  return {
    state: "Customer was charged twice and needs a refund today.",
    questions: {
      important: {
        type: "noul",
        instructions: "Does this need the user's attention?",
      },
      category: {
        type: "choice",
        instructions: "Which category fits?",
        criteria: {
          billing: "Payments and refunds",
          other: "Anything else",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is this?",
        criteria: ["Routine", "Soon", "Immediate"],
      },
    },
  };
}

describe("OllamaDecisionAdapter", () => {
  it("posts a system-one request and parses all answer types", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "tev1:0.8b",
          answers: {
            important: { type: "noul", noul: 0.97 },
            category: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.96, other: 0.04 },
              confidence: 0.91,
            },
            urgency: {
              type: "score",
              score: 1.8,
              legend: ["Routine", "Soon", "Immediate"],
              probabilities: { Routine: 0.1, Soon: 0.1, Immediate: 0.8 },
              confidence: 0.7,
            },
          },
          usage: { input_tokens: 42, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const adapter = new OllamaDecisionAdapter(config, { fetchImpl });
    const result = await adapter.ask(request());

    assert.equal(capturedUrl, "http://127.0.0.1:11434/v1/systemone");
    assert.equal(capturedBody.model, "tev1:0.8b");
    assert.equal(capturedBody.keep_alive, "5m");
    assert.equal(result.answers.important?.type, "noul");
    assert.equal(result.answers.category?.type, "choice");
    assert.equal(result.answers.urgency?.type, "score");
    assert.equal(result.usage.inputTokens, 42);
  });

  it("rejects a response that omits a requested answer", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "tev1:0.8b",
          answers: { important: { type: "noul", noul: 0.5 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const adapter = new OllamaDecisionAdapter(config, { fetchImpl });
    await assert.rejects(adapter.ask(request()), DecisionModelError);
  });

  it("explains a missing decision model", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("model not found", { status: 404 });

    const adapter = new OllamaDecisionAdapter(config, { fetchImpl });
    await assert.rejects(
      adapter.ask(request()),
      /ollama pull tev1:0\.8b/,
    );
  });
});
