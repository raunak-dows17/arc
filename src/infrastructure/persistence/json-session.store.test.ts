import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { AgentSession } from "../../domain/entities/agent-session.js";
import { SessionStoreError } from "../../domain/errors/agent.errors.js";
import { JsonSessionStore } from "./json-session.store.js";

function sampleSession(id: string): AgentSession {
  const session = AgentSession.create(id);
  session.addUserMessage("write a file");
  session.addToolResult("write_file", 'Wrote 5 bytes to "a.txt".');
  session.addAssistantMessage("Done.");
  session.markCompleted();
  return session;
}

describe("JsonSessionStore", () => {
  let directory: string;
  let store: JsonSessionStore;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "agent-sessions-"));
    store = new JsonSessionStore(directory);
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips a session", async () => {
    const session = sampleSession("20261023T120000Z-aaaa1111");
    await store.save(session);

    const loaded = await store.load(session.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.toProps(), session.toProps());
  });

  it("returns null for a missing session", async () => {
    assert.equal(await store.load("does-not-exist"), null);
  });

  it("rejects unsafe session ids", async () => {
    await assert.rejects(store.load("../escape"), SessionStoreError);
  });

  it("loads the latest session and lists summaries", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));

    const newer = sampleSession("20261023T130000Z-bbbb2222");
    await store.save(newer);

    const latest = await store.latest();
    assert.equal(latest?.id, newer.id);

    const summaries = await store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0]?.id, newer.id);
    assert.equal(summaries[0]?.messageCount, 3);
    assert.equal(summaries[0]?.status, "completed");
  });

  it("skips corrupt transcripts in latest() and list()", async () => {
    await writeFile(
      path.join(directory, "broken.json"),
      "{ not valid json",
      "utf8",
    );

    const latest = await store.latest();
    assert.ok(latest);
    assert.equal(latest?.id, "20261023T130000Z-bbbb2222");

    const summaries = await store.list();
    assert.equal(summaries.length, 2);
  });
});
