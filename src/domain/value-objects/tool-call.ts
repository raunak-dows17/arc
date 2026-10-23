export type ToolArguments = Record<string, unknown>;

/**
 * A validated request from the model to run one tool.
 */
export class ToolCall {
  private constructor(
    private readonly toolName: string,
    private readonly toolArgs: ToolArguments,
  ) {}

  static create(name: string, args: ToolArguments = {}): ToolCall {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Tool name cannot be empty.");
    }
    return new ToolCall(trimmed, args);
  }

  get name(): string {
    return this.toolName;
  }

  get args(): ToolArguments {
    return this.toolArgs;
  }

  /**
   * Used to detect a model that keeps repeating the exact same call.
   */
  equals(other: ToolCall): boolean {
    return (
      this.name === other.name &&
      stableStringify(this.args) === stableStringify(other.args)
    );
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}
