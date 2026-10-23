import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MemoryStoreError } from "../../domain/errors/agent.errors.js";
import { FileMemoryStore } from "./file-memory.store.js";

describe("FileMemoryStore", () => {
  let base: string;
  let memory: FileMemoryStore;
  const now = new Date(2026, 9, 23, 14, 30);

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-memory-"));
    memory = new FileMemoryStore(path.join(base, "memory"));
    await memory.initialize();
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("creates default Markdown files", async () => {
    const user = await readFile(path.join(base, "memory", "USER.md"), "utf8");
    const longTerm = await readFile(
      path.join(base, "memory", "MEMORY.md"),
      "utf8",
    );
    assert.match(user, /# User/);
    assert.match(longTerm, /# Long-term memory/);
  });

  it("remembers durable facts and appends dated daily notes", async () => {
    await memory.remember("The user prefers concise answers.", "long-term", now);
    const daily = await memory.appendDaily("Worked on the agent.", now);
    assert.equal(daily.path, "daily/2026-10-23.md");

    const core = await memory.readCore(now);
    assert.match(core.longTerm, /prefers concise answers/);
    assert.match(core.recentDaily, /Worked on the agent/);
  });

  it("searches memory with keyword retrieval and returns snippets", async () => {
    const results = await memory.search("concise answers", 5);
    assert.ok(results.length > 0);
    assert.equal(results[0]?.path, "MEMORY.md");
    assert.match(results[0]?.snippet ?? "", /concise/);
    assert.match(results[0]?.title ?? "", /Long-term memory/);
  });

  it("reads a line range and rejects path escapes", async () => {
    const text = await memory.get("MEMORY.md", 1, 2);
    assert.match(text, /lines 1-2/);
    assert.match(text, /Long-term memory/);

    await assert.rejects(
      memory.get("../USER.md"),
      MemoryStoreError,
    );
  });
});
