import { z } from "zod";
import type { SkillRepositoryPort } from "../../domain/ports/skill-repository.port.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPort,
} from "../../domain/ports/tool.port.js";
import { truncateText } from "../../shared/text.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    name: z.string().trim().min(1),
  })
  .strict();

/** Loads a skill body only when the model decides it is relevant. */
export class LoadSkillTool implements ToolPort {
  constructor(private readonly skills: SkillRepositoryPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "load_skill",
      description:
        "Load the full Markdown instructions for a skill from the skills index. Use this before applying a skill.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact skill name from the skills index.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    };
  }

  async execute(
    rawArgs: unknown,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const skill = await this.skills.get(args.name);
    if (!skill) {
      const names = (await this.skills.list())
        .map((entry) => entry.name)
        .join(", ");
      return `Unknown skill "${args.name}". Available skills: ${names || "none"}.`;
    }
    if (context && !skill.matchesProfile(context.agentId)) {
      return `Skill "${args.name}" is not available to the "${context.agentId}" profile.`;
    }
    if (
      context?.allowedSkills !== undefined &&
      context.allowedSkills !== "*" &&
      !context.allowedSkills.includes(args.name)
    ) {
      return `Skill "${args.name}" is not enabled for the "${context.agentId}" profile.`;
    }

    return [
      `Skill: ${skill.name}`,
      `Description: ${skill.description}`,
      skill.whenToUse ? `When to use: ${skill.whenToUse}` : "",
      "",
      truncateText(skill.body, 12_000),
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}
