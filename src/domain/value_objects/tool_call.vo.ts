// src/domain/value-objects/tool-call.vo.ts

export interface ToolCallProperties {
  readonly name: string;
  arguments: Record<string, any>;
}

export class ToolCallVO {
  constructor(private readonly props: ToolCallProperties) {
    if (!props.name || props.name.trim() === "") {
      throw new Error("Invalid Tool Execution: Tool name cannot be empty.");
    }
    this.props.arguments = Object.freeze({ ...props.arguments });
  }

  public get name(): string {
    return this.props.name;
  }
  public get arguments(): Record<string, any> {
    return this.props.arguments;
  }

  public equals(other: ToolCallVO): boolean {
    return (
      this.name === other.name &&
      JSON.stringify(this.arguments) === JSON.stringify(other.arguments)
    );
  }
}
