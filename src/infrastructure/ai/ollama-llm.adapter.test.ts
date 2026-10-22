import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaLLMAdapter } from "./ollama-llm.adapter.js";

test("an invalid model decision becomes a no-action result after one retry", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(
      JSON.stringify({ message: { content: "{}" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const adapter = new OllamaLLMAdapter();
    const decision = await adapter.generateDecision({
      messages: [{ role: "user", content: "Evaluate the answer." }],
    });

    assert.equal(requestCount, 2);
    assert.match(decision.thought, /Invalid model response/);
    assert.equal(decision.finalAnswer, undefined);
    assert.equal(decision.toolToCall, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
