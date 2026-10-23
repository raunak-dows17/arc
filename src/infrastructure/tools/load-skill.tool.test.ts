import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Skill } from "../../domain/entities/skill.js";
import type { SkillRepositoryPort } from "../../domain/ports/skill-repository.port.js";
import { LoadSkillTool } from "./load-skill.tool.js";

const alpha = Skill.create({
  name: "alpha",
  description: "Alpha skill",
  whenToUse: "alpha work",
  body: "Alpha instructions.",
  sourcePath: "skills/alpha/SKILL.md",
  agents: "*",
  tools: [],
});

const beta = Skill.create({
  name: "beta",
  description: "Beta skill",
  whenToUse: "beta work",
  body: "Beta instructions.",
  sourcePath: "skills/beta/SKILL.md",
  agents: ["researcher"],
  tools: [],
});

const skills: SkillRepositoryPort = {
  get: async (name) =>
    [alpha, beta].find((skill) => skill.name === name) ?? null,
  list: async () => [alpha, beta],
  reload: async () => undefined,
};

describe("LoadSkillTool", () => {
  it("loads an allowed skill body", async () => {
    const result = await new LoadSkillTool(skills).execute(
      { name: "alpha" },
      {
        sessionId: "s1",
        agentId: "assistant",
        depth: 0,
        allowedSkills: ["alpha"],
      },
    );

    assert.match(result, /Skill: alpha/);
    assert.match(result, /Alpha instructions/);
  });

  it("enforces the profile skill allowlist", async () => {
    const result = await new LoadSkillTool(skills).execute(
      { name: "alpha" },
      {
        sessionId: "s1",
        agentId: "assistant",
        depth: 0,
        allowedSkills: ["beta"],
      },
    );

    assert.match(result, /not enabled/);
    assert.doesNotMatch(result, /Alpha instructions/);
  });

  it("enforces agent scoping on the skill", async () => {
    const result = await new LoadSkillTool(skills).execute(
      { name: "beta" },
      {
        sessionId: "s1",
        agentId: "assistant",
        depth: 0,
        allowedSkills: "*",
      },
    );

    assert.match(result, /not available/);
    assert.doesNotMatch(result, /Beta instructions/);
  });
});
