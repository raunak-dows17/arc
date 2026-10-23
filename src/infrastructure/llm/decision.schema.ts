import { z } from "zod";
import { DecisionParseError } from "../../domain/errors/agent.errors.js";
import { AgentDecision } from "../../domain/value-objects/agent-decision.js";
import { ToolCall } from "../../domain/value-objects/tool-call.js";

const toolCallSchema = z.object({
  name: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});

const decisionSchema = z
  .object({
    thought: z.string().max(4000).default(""),
    tool: toolCallSchema.nullable().default(null),
    final: z.string().nullable().default(null),
  })
  .strict();

/**
 * JSON schema passed to Ollama's `format` field. Constrained decoding keeps a
 * small local model on the decision protocol.
 */
export function buildDecisionFormat(
  toolNames: readonly string[],
): Record<string, unknown> {
  const toolCall = {
    type: "object",
    properties: {
      name: { type: "string", enum: [...toolNames] },
      args: { type: "object" },
    },
    required: ["name", "args"],
    additionalProperties: false,
  };

  // Two mutually exclusive shapes: either a tool call (final is null) or a
  // final answer (tool is null). Constraining this in the grammar prevents a
  // small model from filling both fields at once.
  return {
    anyOf: [
      {
        type: "object",
        properties: {
          thought: { type: "string" },
          tool: toolCall,
          final: { type: "null" },
        },
        required: ["thought", "tool", "final"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          thought: { type: "string" },
          tool: { type: "null" },
          final: { type: "string" },
        },
        required: ["thought", "tool", "final"],
        additionalProperties: false,
      },
    ],
  };
}

/**
 * Tolerates accidental code fences or prose around the JSON object.
 */
export function extractJsonObject(content: string): string {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return text;
  }
  return text.slice(start, end + 1);
}

export function parseDecision(content: string): AgentDecision {
  const jsonText = extractJsonObject(content);

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DecisionParseError(`Response was not valid JSON: ${message}`);
  }

  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new DecisionParseError(
      `Response did not match the decision schema: ${issues}`,
    );
  }

  const { thought, tool, final } = parsed.data;
  const hasTool = tool !== null;
  const hasFinal = final !== null && final.trim().length > 0;

  if (hasTool === hasFinal) {
    throw new DecisionParseError(
      'Exactly one of "tool" or "final" must be provided.',
    );
  }

  if (tool) {
    return AgentDecision.useTool(thought, ToolCall.create(tool.name, tool.args));
  }

  return AgentDecision.finish(thought, final?.trim() ?? "");
}
