import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentDecision } from "../../domain/value-objects/agent-decision.js";
import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import {
  FallbackLlmAdapter,
  RoutingLlmAdapter,
  type ProviderLlm,
} from "./routing-llm.adapter.js";
import { ProviderHealthRegistry } from "../models/provider-health.js";

function fakeProvider(
  id: string,
  behavior: "ok" | "fail",
  calls: string[],
): ProviderLlm {
  const llm: LLMPort & TextGenerationPort = {
    async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
      calls.push(`${id}:decision:${request.provider}/${request.model}`);
      if (behavior === "fail") {
        throw new Error(`${id} failed`);
      }
      return {
        decision: AgentDecision.finish("", id),
        usage: { promptTokens: 0, completionTokens: 0, totalDurationMs: 0 },
      };
    },
    async generateText(): Promise<TextGenerationResult> {
      calls.push(`${id}:text`);
      if (behavior === "fail") {
        throw new Error(`${id} failed`);
      }
      return {
        text: id,
        usage: { promptTokens: 0, completionTokens: 0, totalDurationMs: 0 },
      };
    },
  };
  return llm;
}

describe("RoutingLlmAdapter", () => {
  it("dispatches to the selected provider", async () => {
    const calls: string[] = [];
    const routing = new RoutingLlmAdapter(
      {
        google: fakeProvider("google", "ok", calls),
        groq: fakeProvider("groq", "ok", calls),
      },
      { provider: "google", model: "main" },
    );

    await routing.generateDecision({
      systemPrompt: "",
      messages: [],
      tools: [],
      provider: "groq",
      model: "coder",
    });
    assert.deepEqual(calls, ["groq:decision:groq/coder"]);
  });

  it("tries configured fallbacks after a provider failure", async () => {
    const calls: string[] = [];
    const routing = new RoutingLlmAdapter(
      {
        google: fakeProvider("google", "fail", calls),
        groq: fakeProvider("groq", "ok", calls),
      },
      { provider: "google", model: "main" },
    );
    const fallback = new FallbackLlmAdapter(routing, [
      { provider: "groq", model: "backup" },
    ]);

    const result = await fallback.generateDecision({
      systemPrompt: "",
      messages: [],
      tools: [],
    });
    assert.equal(result.decision.finalAnswer, "groq");
    assert.deepEqual(calls, [
      "google:decision:google/main",
      "groq:decision:groq/backup",
    ]);
  });

  it("skips a fallback provider that is cooling down", async () => {
    const calls: string[] = [];
    const health = new ProviderHealthRegistry();
    health.markUnavailable("groq", "backup", "HTTP 429");
    const routing = new RoutingLlmAdapter(
      {
        google: fakeProvider("google", "fail", calls),
        groq: fakeProvider("groq", "ok", calls),
      },
      { provider: "google", model: "main" },
      health,
    );
    const fallback = new FallbackLlmAdapter(
      routing,
      [
        { provider: "groq", model: "backup" },
        { provider: "google", model: "secondary" },
      ],
      health,
    );

    await assert.rejects(
      fallback.generateDecision({
        systemPrompt: "",
        messages: [],
        tools: [],
      }),
    );
    assert.deepEqual(calls, [
      "google:decision:google/main",
      "google:decision:google/secondary",
    ]);
  });
});
