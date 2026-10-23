import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoogleGeminiAdapter } from "./google-gemini.adapter.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GoogleGeminiAdapter", () => {
  it("sends the key in a header and parses a JSON decision", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new GoogleGeminiAdapter({
      baseUrl: "https://example.test/v1beta",
      apiKey: "test-key",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init ? { init } : {}) });
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      thought: "Read the file.",
                      tool: { name: "read_file", args: { path: "a.txt" } },
                      final: null,
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
          },
        });
      }) as typeof fetch,
    });

    const result = await adapter.generateDecision({
      systemPrompt: "system",
      messages: [{ role: "user", content: "read a.txt" }],
      tools: [
        {
          name: "read_file",
          description: "read",
          parameters: { type: "object" },
        },
      ],
    });

    assert.equal(result.decision.toolCall?.name, "read_file");
    assert.equal(result.usage.promptTokens, 10);
    assert.equal(calls[0]?.url.includes(":generateContent"), true);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["x-goog-api-key"], "test-key");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      generationConfig: { responseSchema: unknown };
    };
    assert.ok(body.generationConfig.responseSchema);
  });

  it("lists only generateContent models", async () => {
    const adapter = new GoogleGeminiAdapter({
      baseUrl: "https://example.test/v1beta",
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse({
          models: [
            {
              name: "models/gemini-3.6-flash",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding-1",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        })) as typeof fetch,
    });

    const models = await adapter.listModels();
    assert.deepEqual(models.map((model) => model.id), ["gemini-3.6-flash"]);
  });
});
