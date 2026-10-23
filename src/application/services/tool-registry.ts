import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";

/**
 * Application-level catalogue of tools available to the agent.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolPort>();

  register(tool: ToolPort): void {
    const { name } = tool.getDefinition();
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, tool);
  }

  get(name: string): ToolPort | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.getDefinition());
  }
}
