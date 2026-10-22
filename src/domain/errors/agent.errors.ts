export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class MaxIterationsExceededError extends DomainError {
  constructor(max: number) {
    super(
      `Agent halted safety sequence: Reached max threshold limitation of [${max}] iterations.`,
    );
  }
}

export class ToolExecutionError extends DomainError {
  constructor(toolName: string, innerError: string) {
    super(`Execution failures inside tool [${toolName}]: ${innerError}`);
  }
}
