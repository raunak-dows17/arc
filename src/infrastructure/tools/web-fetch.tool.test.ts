import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebFetchTool } from "./web-fetch.tool.js";

const publicResolver = async (): Promise<string[]> => ["93.184.216.34"];

describe("WebFetchTool", () => {
  it("converts HTML to bounded readable text", async () => {
    const tool = new WebFetchTool({
      resolveHost: publicResolver,
      fetchImpl: async () =>
        new Response(
          "<html><head><title>Hello</title><style>.x{color:red}</style></head><body><h1>Hello &amp; welcome</h1><script>bad()</script><p>ARC is local.</p></body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        ),
    });

    const result = await tool.execute({ url: "https://example.com/page" });

    assert.match(result, /Fetched https:\/\/example\.com\/page/);
    assert.match(result, /Title: Hello/);
    assert.match(result, /Hello & welcome/);
    assert.match(result, /ARC is local\./);
    assert.doesNotMatch(result, /bad\(\)/);
    assert.match(result, /untrusted data/);
  });

  it("re-checks every redirect and refuses private destinations", async () => {
    let calls = 0;
    const tool = new WebFetchTool({
      resolveHost: publicResolver,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/next" },
          });
        }
        return new Response("<p>final</p>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    const result = await tool.execute({ url: "https://example.com/start" });
    assert.match(result, /Fetched https:\/\/example\.com\/next/);
    assert.match(result, /final/);

    const blocked = new WebFetchTool({
      resolveHost: publicResolver,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        }),
    });
    await assert.rejects(
      blocked.execute({ url: "https://example.com/start" }),
      /Blocked redirect/,
    );
  });

  it("refuses private initial URLs before fetching", async () => {
    let fetched = false;
    const tool = new WebFetchTool({
      fetchImpl: async () => {
        fetched = true;
        return new Response("secret");
      },
    });

    await assert.rejects(
      tool.execute({ url: "http://169.254.169.254/latest/meta-data" }),
      /private or reserved|local address/,
    );
    assert.equal(fetched, false);
  });

  it("truncates oversized bodies", async () => {
    const tool = new WebFetchTool({
      resolveHost: publicResolver,
      maxBytes: 20,
      maxChars: 500,
      fetchImpl: async () =>
        new Response(`<p>${"x".repeat(100)}</p>`, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });

    const result = await tool.execute({ url: "https://example.com/big" });
    assert.match(result, /body truncated/);
    assert.match(result, /truncated/);
  });
});
