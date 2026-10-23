import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentProfile } from "../domain/entities/agent-profile.js";
import { AgentSession } from "../domain/entities/agent-session.js";
import type { MemoryStorePort } from "../domain/ports/memory-store.port.js";
import type { SkillRepositoryPort } from "../domain/ports/skill-repository.port.js";
import type { ToolDefinition, ToolPort } from "../domain/ports/tool.port.js";
import { Skill } from "../domain/entities/skill.js";
import { ToolRegistry } from "./services/tool-registry.js";
import { ContextAssembler } from "./services/context-assembler.js";
import type { StandingOrdersPort } from "./services/context-assembler-types.js";

class EchoTool implements ToolPort {
  constructor(private readonly name = "echo") {}
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: `${this.name} tool`,
      parameters: { type: "object" },
    };
  }
  async execute(): Promise<string> {
    return "ok";
  }
}

function profile(): AgentProfile {
  return AgentProfile.create({
    id: "assistant",
    name: "Assistant",
    description: "Test assistant",
    systemPrompt: "Be helpful.",
    tools: ["echo"],
    skills: ["alpha"],
    maxSteps: 4,
    canSpawn: true,
    memoryWrite: true,
    readOnly: false,
    builtIn: true,
  });
}

describe("ContextAssembler", () => {
  it("includes profile, memory, standing orders, and only allowed skills/tools", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool("echo"));
    registry.register(new EchoTool("write_file"));

    const skills: SkillRepositoryPort = {
      get: async () => null,
      list: async () => [
        Skill.create({
          name: "alpha",
          description: "Alpha skill",
          whenToUse: "alpha work",
          body: "secret body",
          sourcePath: "skills/alpha/SKILL.md",
          agents: "*",
          tools: [],
        }),
        Skill.create({
          name: "beta",
          description: "Beta skill",
          whenToUse: "beta work",
          body: "beta body",
          sourcePath: "skills/beta/SKILL.md",
          agents: "*",
          tools: [],
        }),
      ],
      reload: async () => undefined,
    };

    const memory: MemoryStorePort = {
      initialize: async () => undefined,
      readCore: async () => ({
        user: "Name: Ada",
        longTerm: "Prefers tea.",
        recentDaily: "Worked on tests.",
      }),
      appendDaily: async () => ({ path: "daily/x.md", bytes: 1 }),
      remember: async () => ({ path: "MEMORY.md", bytes: 1 }),
      search: async () => [],
      get: async () => "",
    };

    const standingOrders: StandingOrdersPort = {
      read: async () => "Always cite file paths.",
    };

    const assembler = new ContextAssembler({
      registry,
      skills,
      memory,
      standingOrders,
      workspaceLabel: "sandbox",
      options: {
        maxMessages: 10,
        maxContextChars: 16_000,
        maxObservationChars: 1_000,
        maxMemoryChars: 4_000,
        maxSkillIndexChars: 2_000,
      },
    });

    const session = AgentSession.create("s1");
    session.addUserMessage("hello");
    session.addAssistantMessage("hi");
    session.setSummary("Earlier summary.", 1);

    const context = await assembler.assemble(session, profile());

    assert.match(context.systemPrompt, /Assistant/);
    assert.match(context.systemPrompt, /Always cite file paths/);
    assert.match(context.systemPrompt, /Name: Ada/);
    assert.match(context.systemPrompt, /Prefers tea/);
    assert.match(context.systemPrompt, /alpha: Alpha skill/);
    assert.doesNotMatch(context.systemPrompt, /beta: Beta skill/);
    assert.doesNotMatch(context.systemPrompt, /secret body/);
    assert.match(context.systemPrompt, /echo tool/);
    assert.doesNotMatch(context.systemPrompt, /write_file tool/);

    assert.equal(context.messages[0]?.content, "Summary of earlier conversation:\nEarlier summary.");
    assert.equal(context.tools.length, 1);
  });
});
