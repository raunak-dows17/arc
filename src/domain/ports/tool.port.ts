export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema describing the accepted arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolPort {
  getDefinition(): ToolDefinition;
  execute(args: unknown): Promise<string>;
}
