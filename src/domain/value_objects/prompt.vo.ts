export interface PromptProperties {
  readonly template: string;
  variables: Record<string, string>;
}

export class PromptVO {
  private readonly renderedText: string;

  constructor(private readonly props: PromptProperties) {
    if (!props.template || props.template.trim() === "") {
      throw new Error(
        "Invalid Prompt: System or User template cannot be empty.",
      );
    }
    this.props.variables = Object.freeze({ ...props.variables });
    this.renderedText = this.compileTemplate(
      props.template,
      this.props.variables,
    );
  }

  public get template(): string {
    return this.props.template;
  }
  public get variables(): Record<string, string> {
    return this.props.variables;
  }

  public toString(): string {
    return this.renderedText;
  }

  // Simple string replacer: e.g., "Hello {{name}}" -> "Hello Alice"
  private compileTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
    }
    return result;
  }
}
