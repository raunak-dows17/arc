import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MarkdownAgentProfileRepository } from "./markdown-profile.repository.js";

describe("MarkdownAgentProfileRepository", () => {
  let directory: string;
  let profiles: MarkdownAgentProfileRepository;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "agent-profiles-"));
    await writeFile(
      path.join(directory, "researcher.md"),
      [
        "---",
        "name: researcher",
        "description: Custom researcher",
        "tools:",
        "  - read_file",
        "  - memory_search",
        "skills: daily-review",
        "maxSteps: 5",
        "canSpawn: false",
        "---",
        "",
        "You are my custom researcher.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(directory, "broken.md"),
      "---\nname: [unterminated\n---\nbody",
      "utf8",
    );
    profiles = new MarkdownAgentProfileRepository(directory);
    await profiles.reload();
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("loads built-in profiles and applies user overrides", async () => {
    const arc = await profiles.get("arc");
    assert.ok(arc);
    assert.equal(arc.builtIn, true);
    assert.equal(arc.canSpawn, true);
    assert.match(arc.description, /Autonomous Regenerative Companion/);

    const researcher = await profiles.get("researcher");
    assert.ok(researcher);
    assert.equal(researcher.builtIn, false);
    assert.equal(researcher.description, "Custom researcher");
    assert.equal(researcher.maxSteps, 5);
    assert.deepEqual(researcher.tools, ["read_file", "memory_search"]);
    assert.deepEqual(researcher.skills, ["daily-review"]);
    assert.match(researcher.systemPrompt, /custom researcher/);
  });

  it("lists the full catalogue and ignores malformed files", async () => {
    const all = await profiles.list();
    const ids = all.map((profile) => profile.id);
    assert.ok(ids.includes("arc"));
    assert.ok(ids.includes("reviewer"));
    assert.ok(ids.includes("writer"));
    assert.ok(!ids.includes("broken"));
  });
});
