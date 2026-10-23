import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemorySecretStore } from "../secrets/in-memory.secret-store.js";
import { SECRET_ACCOUNTS } from "../../shared/secret-accounts.js";
import { BraveWebSearchTool } from "./brave-web-search.tool.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BraveWebSearchTool", () => {
  it("explains how to configure a missing API key", async () => {
    const tool = new BraveWebSearchTool({
      secrets: new InMemorySecretStore(),
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    const result = await tool.execute({ query: "arc" });

    assert.match(result, /not configured/);
    assert.match(result, /arc secrets set brave.api-key/);
  });

  it("queries Brave with the keyring key and formats results", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_ACCOUNTS.braveApiKey, "test-key");
    let calledUrl = "";
    let calledKey = "";
    const tool = new BraveWebSearchTool({
      secrets,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        calledUrl = String(input);
        calledKey = String(
          (init?.headers as Record<string, string>)?.["X-Subscription-Token"],
        );
        return response({
          web: {
            results: [
              {
                title: "ARC local agent",
                url: "https://example.com/arc",
                description: "A local-first agent.",
                age: "2 days ago",
              },
            ],
          },
        });
      }) as typeof fetch,
    });

    const result = await tool.execute({ query: "ARC local agent", count: 3 });

    assert.equal(calledKey, "test-key");
    const url = new URL(calledUrl);
    assert.equal(url.searchParams.get("q"), "ARC local agent");
    assert.equal(url.searchParams.get("count"), "3");
    assert.match(result, /Brave results for "ARC local agent"/);
    assert.match(result, /https:\/\/example\.com\/arc/);
    assert.match(result, /untrusted data/);
  });

  it("caches identical searches and reports rate limits", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_ACCOUNTS.braveApiKey, "test-key");
    let calls = 0;
    let now = 1_000;
    const tool = new BraveWebSearchTool({
      secrets,
      now: () => now,
      cacheTtlMs: 5_000,
      fetchImpl: async () => {
        calls += 1;
        return response({
          web: {
            results: [
              { title: "One", url: "https://example.com/one", description: "x" },
            ],
          },
        });
      },
    });

    await tool.execute({ query: "same" });
    await tool.execute({ query: "same" });
    assert.equal(calls, 1);

    now += 6_000;
    await tool.execute({ query: "same" });
    assert.equal(calls, 2);

    const rateLimited = new BraveWebSearchTool({
      secrets,
      fetchImpl: async () => response({ error: "quota" }, 429),
    });
    assert.match(await rateLimited.execute({ query: "x" }), /rate limit/);
  });
});
