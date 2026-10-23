export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema describing the accepted arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  depth: number;
  /** Skills allowed for the active profile; "*" means all. */
  allowedSkills?: "*" | readonly string[];
  signal?: AbortSignal;
}

export interface ToolPort {
  getDefinition(): ToolDefinition;
  execute(args: unknown, context?: ToolExecutionContext): Promise<string>;
}
