export type SessionMessageRole = "user" | "assistant" | "tool";

export interface SessionMessage {
  role: SessionMessageRole;
  content: string;
  /** Present for tool observation messages. */
  toolName?: string;
  at: string;
}

export type SessionStatus = "active" | "completed" | "failed";

export interface AgentSessionProps {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  messages: SessionMessage[];
}

/**
 * A conversation with the agent. The full transcript is persisted; the
 * application layer trims it before sending anything to the model.
 */
export class AgentSession {
  private constructor(private readonly props: AgentSessionProps) {}

  static create(id: string, now: Date = new Date()): AgentSession {
    const timestamp = now.toISOString();
    return new AgentSession({
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "active",
      messages: [],
    });
  }

  static restore(props: AgentSessionProps): AgentSession {
    return new AgentSession({
      ...props,
      messages: props.messages.map((message) => ({ ...message })),
    });
  }

  get id(): string {
    return this.props.id;
  }

  get createdAt(): string {
    return this.props.createdAt;
  }

  get updatedAt(): string {
    return this.props.updatedAt;
  }

  get status(): SessionStatus {
    return this.props.status;
  }

  get messages(): readonly SessionMessage[] {
    return this.props.messages;
  }

  addUserMessage(content: string): void {
    this.props.messages.push({
      role: "user",
      content,
      at: this.timestamp(),
    });
    this.props.status = "active";
    this.touch();
  }

  addAssistantMessage(content: string): void {
    this.props.messages.push({
      role: "assistant",
      content,
      at: this.timestamp(),
    });
    this.touch();
  }

  addToolResult(toolName: string, content: string): void {
    this.props.messages.push({
      role: "tool",
      toolName,
      content,
      at: this.timestamp(),
    });
    this.touch();
  }

  markCompleted(): void {
    this.props.status = "completed";
    this.touch();
  }

  markFailed(): void {
    this.props.status = "failed";
    this.touch();
  }

  toProps(): AgentSessionProps {
    return {
      ...this.props,
      messages: this.props.messages.map((message) => ({ ...message })),
    };
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private touch(): void {
    this.props.updatedAt = this.timestamp();
  }
}
