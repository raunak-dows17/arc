import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentEvent } from "../../domain/events/agent-event.js";
import { InMemoryEventBus } from "./in-memory-event-bus.js";
import { JsonlAuditLogger } from "./jsonl-audit.logger.js";

describe("events and audit", () => {
  let directory: string;
  let file: string;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "agent-audit-"));
    file = path.join(directory, "audit.jsonl");
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("isolates failing event listeners", () => {
    const bus = new InMemoryEventBus();
    const seen: AgentEvent[] = [];
    bus.on("tool.finished", () => {
      throw new Error("listener failure");
    });
    bus.on("*", (event) => seen.push(event));

    bus.emit("tool.finished", {
      sessionId: "s1",
      agentId: "assistant",
      data: { tool: "read_file" },
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.type, "tool.finished");
  });

  it("redacts sensitive keys and truncates long strings", async () => {
    const logger = new JsonlAuditLogger(file);
    const bus = new InMemoryEventBus();
    bus.on("*", (event) => logger.recordSafely(event));

    bus.emit("tool.finished", {
      sessionId: "s1",
      agentId: "assistant",
      data: {
        tool: "write_file",
        token: "super-secret",
        observation: "x".repeat(3_000),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const line = (await readFile(file, "utf8")).trim();
    const event = JSON.parse(line) as AgentEvent;
    assert.equal(event.data.token, "[redacted]");
    assert.match(String(event.data.observation), /\[truncated\]/);
    assert.doesNotMatch(line, /super-secret/);
  });
});
