import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { AgentSession } from "../../domain/entities/agent-session.js";
import { JsonSessionStore } from "./json-session.store.js";

describe("JsonSessionStore v2", () => {
  let directory: string;
  let store: JsonSessionStore;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "agent-sessions-v2-"));
    store = new JsonSessionStore(directory);
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips profile, parent, summary, and usage", async () => {
    const session = AgentSession.create("root-session", {
      agentId: "arc",
    });
    session.addUserMessage("task");
    session.addAssistantMessage("done");
    session.setSummary("Earlier work.", 1);
    session.recordUsage({
      promptTokens: 100,
      completionTokens: 20,
      totalDurationMs: 50,
    });
    session.markCompleted();
    await store.save(session);

    const loaded = await store.load(session.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.toProps(), session.toProps());
    assert.equal(loaded.agentId, "arc");
    assert.equal(loaded.summary?.throughMessageCount, 1);
    assert.equal(loaded.usage.modelCalls, 1);
  });

  it("keeps child sessions out of latest() but includes them in list()", async () => {
    const parent = AgentSession.create("parent-session", {
      agentId: "arc",
    });
    parent.addAssistantMessage("parent");
    await store.save(parent);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const child = AgentSession.create("child-session", {
      agentId: "researcher",
      parentId: parent.id,
      depth: 1,
    });
    child.addAssistantMessage("child");
    await store.save(child);

    assert.equal((await store.latest())?.id, parent.id);

    const summaries = await store.list();
    const childSummary = summaries.find((entry) => entry.id === child.id);
    assert.ok(childSummary);
    assert.equal(childSummary.parentId, parent.id);
    assert.equal(childSummary.agentId, "researcher");
  });

  it("loads v1 transcripts with safe defaults", async () => {
    await writeFile(
      path.join(directory, "legacy.json"),
      JSON.stringify({
        id: "legacy",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        status: "completed",
        messages: [
          {
            role: "user",
            content: "hello",
            at: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    const loaded = await store.load("legacy");
    assert.ok(loaded);
    assert.equal(loaded.agentId, "arc");
    assert.equal(loaded.parentId, null);
    assert.equal(loaded.depth, 0);
    assert.equal(loaded.summary, null);
    assert.equal(loaded.usage.modelCalls, 0);
  });
});
