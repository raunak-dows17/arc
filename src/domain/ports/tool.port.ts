import type { ToolCallVO } from "../value_objects/tool_call.vo.js";

// src/domain/ports/tool.port.ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema detailing acceptable tool parameters
}

export interface ToolPort {
  getDefinition(): ToolDefinition;
  execute(toolCall: ToolCallVO): Promise<string>;
}
