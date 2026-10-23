import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenAiCompatibleAdapter } from "./openai-compatible.adapter.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAiCompatibleAdapter", () => {
  it("uses bearer auth and JSON mode for a decision", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new OpenAiCompatibleAdapter({
      providerId: "groq",
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init ? { init } : {}) });
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  thought: "",
                  tool: null,
                  final: "hello",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        });
      }) as typeof fetch,
    });

    const result = await adapter.generateDecision({
      systemPrompt: "system",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    assert.equal(result.decision.finalAnswer, "hello");
    assert.equal(result.usage.totalDurationMs, 0);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-key");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      response_format: unknown;
    };
    assert.deepEqual(body.response_format, { type: "json_object" });
  });

  it("lists models from the OpenAI-compatible endpoint", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      providerId: "groq",
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse({
          data: [{ id: "llama-3.3-70b-versatile", context_length: 128000 }],
        })) as typeof fetch,
    });

    assert.deepEqual(await adapter.listModels(), [
      { id: "llama-3.3-70b-versatile", contextLength: 128000 },
    ]);
  });
});
