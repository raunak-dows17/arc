import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

export class RegisterToolUseCase {
  // InMemory storage acting as our operational registry system
  private readonly toolRegistry: Map<string, ToolPort> = new Map();

  constructor() {}

  /**
   * Registers an external tool adapter into the agent infrastructure runtime environment.
   * @param tool Concrete tool implementation adhering to domain specifications.
   */
  public async execute(tool: ToolPort): Promise<void> {
    const definition: ToolDefinition = tool.getDefinition();

    if (!definition.name || definition.name.trim() === "") {
      agentLogger.error(
        "Failed to register tool due to missing unique name specification",
      );
      throw new Error(
        "Tool registration rejected: Definition must provide a non-empty name string.",
      );
    }

    if (this.toolRegistry.has(definition.name)) {
      agentLogger.warn(
        `Overwriting previously registered tool instance: [${definition.name}]`,
      );
    }

    // Save instance inside runtime execution container mapping
    this.toolRegistry.set(definition.name, tool);

    agentLogger.info(
      "Successfully registered autonomous execution tool adapter",
      {
        toolName: definition.name,
        parameterCount: Object.keys(definition.parameters?.properties || {})
          .length,
      },
    );
  }

  /**
   * Retrieves a verified tool signature instance via its unique string lookup identifier.
   */
  public getTool(name: string): ToolPort | undefined {
    return this.toolRegistry.get(name);
  }

  /**
   * Compiles list of all available active structural schema specifications for LLM mapping injection.
   */
  public getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.toolRegistry.values()).map((tool) =>
      tool.getDefinition(),
    );
  }

  /**
   * Empties the current dynamic runtime memory allocation context layout map.
   */
  public clearRegistry(): void {
    this.toolRegistry.clear();
    agentLogger.debug(
      "Tool execution ecosystem sandbox database cleared completely",
    );
  }
}
