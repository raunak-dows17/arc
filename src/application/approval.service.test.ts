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
    mode: "always",
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

  it("reuses a session grant for the same tool and session", async () => {
    let asks = 0;
    const prompt: ApprovalPromptPort = {
      async ask() {
        asks += 1;
        return {
          approved: true,
          decidedBy: "user",
          rememberForSession: true,
        };
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });
    const webRequest = {
      ...request(),
      toolName: "web_fetch",
      risk: "network" as const,
      mode: "session" as const,
    };

    const first = await service.request(webRequest);
    const second = await service.request(webRequest);
    const otherTool = await service.request({
      ...webRequest,
      toolName: "web_search",
    });

    assert.equal(first.decidedBy, "user");
    assert.equal(second.decidedBy, "session");
    assert.equal(otherTool.decidedBy, "user");
    assert.equal(asks, 2);
  });

  it("never remembers shell approvals even if the prompt asks to", async () => {
    let asks = 0;
    const prompt: ApprovalPromptPort = {
      async ask() {
        asks += 1;
        return {
          approved: true,
          decidedBy: "user",
          rememberForSession: true,
        };
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });

    await service.request(request());
    await service.request(request());

    assert.equal(asks, 2);
  });

  it("clears grants for a replaced session", async () => {
    let asks = 0;
    const prompt: ApprovalPromptPort = {
      async ask() {
        asks += 1;
        return {
          approved: true,
          decidedBy: "user",
          rememberForSession: true,
        };
      },
    };
    const service = new ApprovalService(prompt, { ttlMs: 1_000 });
    const webRequest = {
      ...request(),
      toolName: "web_fetch",
      risk: "network" as const,
      mode: "session" as const,
    };

    await service.request(webRequest);
    service.clearSession("session-1");
    await service.request(webRequest);

    assert.equal(asks, 2);
  });
});
