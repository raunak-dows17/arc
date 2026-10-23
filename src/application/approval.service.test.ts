import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApprovalService } from "./services/approval.service.js";
import type { ApprovalPromptPort } from "./services/approval.service.js";
import type { ApprovalRequest } from "../domain/ports/approval.port.js";

function request(): Omit<ApprovalRequest, "id" | "expiresAt"> {
  return {
    toolName: "shell",
    args: { command: "npm test" },
    risk: "shell",
    reason: "Run the test suite.",
    channel: "cli",
    sessionId: "session-1",
    turnId: "turn-1",
  };
}

describe("ApprovalService", () => {
  it("returns an approval from the prompt", async () => {
    const prompt: ApprovalPromptPort = {
      async ask() {
        return { approved: true, decidedBy: "user" };
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });

    const decision = await service.request(request());

    assert.equal(decision.approved, true);
    assert.equal(decision.decidedBy, "user");
  });

  it("expires to a denial without a human response", async () => {
    const prompt: ApprovalPromptPort = {
      ask() {
        return new Promise(() => undefined);
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 10 });

    const decision = await service.request(request());

    assert.equal(decision.approved, false);
    assert.equal(decision.decidedBy, "timeout");
  });

  it("fails closed when the prompt throws", async () => {
    const prompt: ApprovalPromptPort = {
      async ask() {
        throw new Error("stdin unavailable");
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });

    const decision = await service.request(request());

    assert.equal(decision.approved, false);
    assert.match(decision.reason ?? "", /stdin unavailable/);
  });

  it("denies when the turn is cancelled", async () => {
    const prompt: ApprovalPromptPort = {
      ask() {
        return new Promise(() => undefined);
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });
    const controller = new AbortController();
    controller.abort();

    const decision = await service.request(request(), controller.signal);

    assert.equal(decision.approved, false);
    assert.equal(decision.decidedBy, "abort");
  });
});
