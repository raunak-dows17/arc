import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApprovalRequest } from "../../domain/ports/approval.port.js";
import type { TelegramApi } from "./telegram.api.js";
import {
  formatApprovalRequest,
  TelegramApprovalPrompt,
} from "./telegram.approval.prompt.js";

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "req-1",
    toolName: "shell",
    args: { command: "Get-ChildItem" },
    risk: "shell",
    reason: "Run a shell command.",
    channel: "telegram",
    sessionId: "session-1",
    mode: "always",
    expiresAt: 6_000,
    ...overrides,
  };
}

function fakeApi() {
  const sent: Array<{ chatId: string | number; text: string }> = [];
  const api = {
    async sendMessage(chatId: string | number, text: string) {
      sent.push({ chatId, text });
    },
  } as unknown as TelegramApi;
  return { api, sent };
}

describe("TelegramApprovalPrompt", () => {
  it("sends an approval request and accepts a yes reply", async () => {
    const { api, sent } = fakeApi();
    const prompt = new TelegramApprovalPrompt(api, {
      defaultChatId: "123",
      now: () => 1_000,
    });

    const decision = prompt.ask(request());
    assert.match(sent[0]?.text ?? "", /ARC approval required/);
    assert.match(sent[0]?.text ?? "", /yes req-1/);
    assert.equal(prompt.pendingCount, 1);

    assert.equal(prompt.handleReply("123", "yes req-1"), true);
    const result = await decision;
    assert.equal(result.approved, true);
    assert.equal(result.decidedBy, "user");
    assert.equal(prompt.pendingCount, 0);
  });

  it("accepts a session grant only for session-scoped tools", async () => {
    const { api } = fakeApi();
    const prompt = new TelegramApprovalPrompt(api, {
      defaultChatId: "123",
      now: () => 1_000,
    });

    const sessionDecision = prompt.ask(
      request({ id: "req-2", toolName: "web_fetch", risk: "network", mode: "session" }),
    );
    assert.equal(prompt.handleReply("123", "session req-2"), true);
    const sessionResult = await sessionDecision;
    assert.equal(sessionResult.approved, true);
    assert.equal(sessionResult.rememberForSession, true);

    const shellDecision = prompt.ask(request({ id: "req-3" }));
    assert.equal(prompt.handleReply("123", "session req-3"), true);
    assert.equal(prompt.pendingCount, 1);
    assert.equal(prompt.handleReply("123", "no req-3"), true);
    const shellResult = await shellDecision;
    assert.equal(shellResult.approved, false);
  });

  it("ignores replies from another chat and denies non-Telegram channels", async () => {
    const { api } = fakeApi();
    const prompt = new TelegramApprovalPrompt(api, {
      defaultChatId: "123",
      now: () => 1_000,
    });

    const decision = prompt.ask(request({ id: "req-4" }));
    assert.equal(prompt.handleReply("999", "yes req-4"), false);
    assert.equal(prompt.handleReply("123", "no req-4"), true);
    assert.equal((await decision).approved, false);

    const cli = await prompt.ask(
      request({ id: "req-5", channel: "cli" }),
    );
    assert.equal(cli.approved, false);
    assert.match(cli.reason ?? "", /not addressed to the Telegram channel/);
  });

  it("cancels pending requests when the runtime shuts down", async () => {
    const { api } = fakeApi();
    const prompt = new TelegramApprovalPrompt(api, {
      defaultChatId: "123",
      now: () => 1_000,
    });

    const decision = prompt.ask(request({ id: "req-6" }));
    prompt.cancelAll("shutdown");
    const result = await decision;
    assert.equal(result.approved, false);
    assert.equal(result.decidedBy, "cancelled");
  });

  it("formats the request with the exact reply commands", () => {
    const text = formatApprovalRequest(request({ id: "req-7" }));
    assert.match(text, /Tool: shell/);
    assert.match(text, /Request: req-7/);
    assert.match(text, /yes req-7/);
    assert.match(text, /no req-7/);
    assert.doesNotMatch(text, /session req-7/);
  });
});
