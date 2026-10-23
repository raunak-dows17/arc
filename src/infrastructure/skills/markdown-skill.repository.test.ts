import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MarkdownSkillRepository } from "./markdown-skill.repository.js";

async function writeSkill(
  directory: string,
  folder: string,
  body: string,
): Promise<void> {
  const target = path.join(directory, folder);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "SKILL.md"), body, "utf8");
}

describe("MarkdownSkillRepository", () => {
  let base: string;
  let repository: MarkdownSkillRepository;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-skills-"));
    const builtin = path.join(base, "builtin");
    const user = path.join(base, "user");
    await writeSkill(
      builtin,
      "alpha",
      [
        "---",
        "name: alpha",
        "description: Built-in alpha",
        "whenToUse: testing",
        "tools: [read_file]",
        "---",
        "",
        "Built-in body.",
      ].join("\n"),
    );
    await writeSkill(
      builtin,
      "beta",
      [
        "---",
        "name: beta",
        "description: Built-in beta",
        "agents: researcher",
        "---",
        "",
        "Beta body.",
      ].join("\n"),
    );
    await writeSkill(
      user,
      "alpha",
      [
        "---",
        "name: alpha",
        "description: User alpha",
        "agents: [assistant, reviewer]",
        "---",
        "",
        "User override body.",
      ].join("\n"),
    );
    repository = new MarkdownSkillRepository([builtin, user]);
    await repository.reload();
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("applies later directories as overrides", async () => {
    const alpha = await repository.get("alpha");
    assert.ok(alpha);
    assert.equal(alpha.description, "User alpha");
    assert.equal(alpha.body, "User override body.");
    assert.deepEqual(alpha.agents, ["assistant", "reviewer"]);
  });

  it("parses agent scoping and tool metadata", async () => {
    const beta = await repository.get("beta");
    assert.ok(beta);
    assert.equal(beta.matchesProfile("researcher"), true);
    assert.equal(beta.matchesProfile("assistant"), false);
    assert.deepEqual(beta.tools, []);

    const alpha = await repository.get("alpha");
    assert.deepEqual(alpha?.tools, []);
  });

  it("lists skills alphabetically", async () => {
    assert.deepEqual(
      (await repository.list()).map((skill) => skill.name),
      ["alpha", "beta"],
    );
  });
});
