import type { ToolDefinition } from "../../domain/ports/tool.port.js";

export interface SystemPromptInput {
  tools: readonly ToolDefinition[];
  sandboxLabel: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const toolsJson = JSON.stringify(
    input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    null,
    2,
  );

  return [
    "You are a local autonomous agent running on the user's machine.",
    `You work inside a sandbox directory (${input.sandboxLabel}). Every path in a tool call is RELATIVE to that sandbox root. Never use absolute paths; use "." for the sandbox root.`,
    "You run in a loop: each response is exactly one JSON object. Choose either one tool call or a final answer.",
    "",
    "Response rules:",
    '- To call a tool, set "tool" to {"name": "...", "args": {...}} and set "final" to null.',
    '- To finish, set "final" to the complete answer for the user and set "tool" to null.',
    '- "thought" is a short note (one or two sentences) about your next action. Do not include hidden reasoning.',
    "- Call one tool per step and wait for its observation before deciding again.",
    "- Never invent tool results. Only rely on observations you actually received.",
    "- Do not repeat the same tool call with identical arguments.",
    "- List or read files before modifying them when the task depends on existing content.",
    "- write_file replaces the whole file, so include the complete intended content in one call.",
    "- If a tool fails, adapt your approach or explain the failure in your final answer.",
    "- When the task is done, keep the final answer short: what you did and which files changed.",
    "",
    "Available tools:",
    toolsJson,
    "",
    `Current date: ${new Date().toISOString().slice(0, 10)}.`,
  ].join("\n");
}
