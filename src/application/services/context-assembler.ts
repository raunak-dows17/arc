import type { AgentProfile } from "../../domain/entities/agent-profile.js";
import type { AgentSession } from "../../domain/entities/agent-session.js";
import type { MemoryStorePort } from "../../domain/ports/memory-store.port.js";
import type { SkillRepositoryPort } from "../../domain/ports/skill-repository.port.js";
import type { LlmMessage } from "../../domain/ports/llm.port.js";
import type { ToolDefinition } from "../../domain/ports/tool.port.js";
import { truncateText } from "../../shared/text.js";
import { buildContextMessages } from "./context-builder.js";
import type {
  ContextAssemblerOptions,
  StandingOrdersPort,
} from "./context-assembler-types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface AssembledContext {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
}

/**
 * Builds the complete bounded model context for one step: profile instructions,
 * standing orders, memory, the skill index, tool schemas, and recent history.
 * Skill bodies never enter context unless the model calls load_skill.
 */
export class ContextAssembler {
  constructor(
    private readonly deps: {
      registry: ToolRegistry;
      skills: SkillRepositoryPort;
      memory: MemoryStorePort;
      standingOrders: StandingOrdersPort;
      workspaceLabel: string;
      options: ContextAssemblerOptions;
    },
  ) {}

  async assemble(
    session: AgentSession,
    profile: AgentProfile,
  ): Promise<AssembledContext> {
    const tools = this.deps.registry
      .getDefinitions()
      .filter((tool) => profile.allowsTool(tool.name));

    const [skills, memory, standingOrders] = await Promise.all([
      this.deps.skills.list(),
      this.deps.memory.readCore(),
      this.deps.standingOrders.read(),
    ]);

    const visibleSkills = skills.filter(
      (skill) =>
        profile.allowsSkill(skill.name) && skill.matchesProfile(profile.id),
    );
    const skillIndex = visibleSkills
      .map((skill) => {
        const when = skill.whenToUse ? ` — when: ${skill.whenToUse}` : "";
        return `- ${skill.name}: ${skill.description}${when}`;
      })
      .join("\n");

    const systemPrompt = buildSystemPrompt({
      profile,
      tools,
      workspaceLabel: this.deps.workspaceLabel,
      standingOrders,
      memory,
      skillIndex,
      maxMemoryChars: this.deps.options.maxMemoryChars,
      maxSkillIndexChars: this.deps.options.maxSkillIndexChars,
    });

    const historyBudget = Math.max(
      1_500,
      this.deps.options.maxContextChars - systemPrompt.length,
    );
    const messages = buildContextMessages(session.workingMessages, {
      maxMessages: this.deps.options.maxMessages,
      maxContextChars: historyBudget,
      maxObservationChars: this.deps.options.maxObservationChars,
    });

    if (session.summary) {
      const summary = truncateText(
        `Summary of earlier conversation:\n${session.summary.text}`,
        Math.max(400, Math.floor(historyBudget * 0.4)),
      );
      messages.unshift({ role: "assistant", content: summary });
    }

    return { systemPrompt, messages, tools };
  }

  /** Lightweight estimate used by /status. */
  async estimate(
    session: AgentSession,
    profile: AgentProfile,
  ): Promise<{ systemChars: number; historyChars: number; messages: number }> {
    const context = await this.assemble(session, profile);
    return {
      systemChars: context.systemPrompt.length,
      historyChars: context.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      ),
      messages: context.messages.length,
    };
  }
}
