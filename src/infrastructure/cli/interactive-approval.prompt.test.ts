import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApprovalRequest } from "../../domain/ports/approval.port.js";
import {
  InteractiveApprovalPrompt,
  parseApprovalAnswer,
} from "./interactive-approval.prompt.js";

function request(): ApprovalRequest {
  return {
    id: "approval-1",
    toolName: "web_fetch",
    args: { url: "https://example.com" },
    risk: "network",
    reason: "Fetch a page.",
    channel: "cli",
    sessionId: "session-1",
    mode: "session",
    expiresAt: Date.now() + 60_000,
  };
}

describe("InteractiveApprovalPrompt", () => {
  it("fails closed before a terminal handler is installed", async () => {
    const prompt = new InteractiveApprovalPrompt();
    const decision = await prompt.ask(request());

    assert.equal(decision.approved, false);
    assert.equal(decision.decidedBy, "policy");
  });

  it("delegates to the installed handler", async () => {
    const prompt = new InteractiveApprovalPrompt();
    prompt.setHandler(async (approvalRequest) => ({
      approved: true,
      decidedBy: "user",
      rememberForSession: approvalRequest.mode === "session",
    }));

    const decision = await prompt.ask(request());
    assert.equal(decision.approved, true);
    assert.equal(decision.rememberForSession, true);

    prompt.setHandler(null);
    assert.equal((await prompt.ask(request())).approved, false);
  });

  it("parses once, session, and denial answers", () => {
    assert.deepEqual(parseApprovalAnswer("y", "always"), {
      approved: true,
      rememberForSession: false,
    });
    assert.deepEqual(parseApprovalAnswer("YES", "session"), {
      approved: true,
      rememberForSession: false,
    });
    assert.deepEqual(parseApprovalAnswer("s", "session"), {
      approved: true,
      rememberForSession: true,
    });
    assert.deepEqual(parseApprovalAnswer("session", "session"), {
      approved: true,
      rememberForSession: true,
    });
    assert.deepEqual(parseApprovalAnswer("s", "always"), {
      approved: false,
      rememberForSession: false,
    });
    assert.deepEqual(parseApprovalAnswer("n", "session"), {
      approved: false,
      rememberForSession: false,
    });
  });
});
