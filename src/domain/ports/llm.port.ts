import type { ToolCallProperties } from "../value_objects/tool_call.vo.js";

export interface DomainMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Tracks which specific tool generated the string context
}

export interface AgentDecision {
  thought: string;
  toolToCall?: ToolCallProperties;
  finalAnswer?: string;
}

export interface LLMRequirements {
  messages: DomainMessage[];
  systemPrompt?: string;
}

export interface LLMPort {
  generateDecision(requirements: LLMRequirements): Promise<AgentDecision>;
}
