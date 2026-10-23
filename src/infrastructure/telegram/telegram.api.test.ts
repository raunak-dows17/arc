import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  splitTelegramMessage,
  TelegramApi,
} from "./telegram.api.js";

describe("TelegramApi", () => {
  it("polls updates with an offset and sends plain-text messages", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({
          ok: true,
          result:
            calls.length === 1
              ? [{ update_id: 10, message: { message_id: 1, date: 1, chat: { id: 123, type: "private" }, text: "hi" } }]
              : true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const api = new TelegramApi({
      token: "TOKEN",
      baseUrl: "https://telegram.test",
      fetchImpl,
    });

    const updates = await api.getUpdates({ offset: 7, timeoutSec: 30 });
    assert.equal(updates.length, 1);
    assert.match(calls[0]?.url ?? "", /\/botTOKEN\/getUpdates/);
    assert.match(calls[0]?.url ?? "", /offset=7/);
    assert.match(calls[0]?.url ?? "", /timeout=30/);
    assert.match(calls[0]?.url ?? "", /allowed_updates=/);

    await api.sendMessage(123, "hello");
    assert.match(calls[1]?.url ?? "", /\/botTOKEN\/sendMessage/);
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    assert.equal(body.chat_id, 123);
    assert.equal(body.text, "hello");
    assert.equal(body.disable_web_page_preview, true);
  });

  it("surfaces Telegram API errors without leaking the token", async () => {
    const api = new TelegramApi({
      token: "SECRET-TOKEN",
      baseUrl: "https://telegram.test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ ok: false, description: "Bad Request" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    });

    await assert.rejects(api.sendMessage(1, "x"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Bad Request/);
      assert.doesNotMatch(error.message, /SECRET-TOKEN/);
      return true;
    });
  });

  it("splits long messages below Telegram's limit", () => {
    const chunks = splitTelegramMessage("word ".repeat(200), 120);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 120));
  });
});
