export type SessionMessageRole = "user" | "assistant" | "tool";

export interface SessionMessage {
  role: SessionMessageRole;
  content: string;
  /** Present for tool observation messages. */
  toolName?: string;
  at: string;
}

export type SessionStatus = "active" | "completed" | "failed";

/** Token accounting reported by the model adapter. */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalDurationMs: number;
}

/** Accumulated usage for one conversation. */
export interface SessionUsage {
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalDurationMs: number;
}

/** A compacted view of the older part of a transcript. */
export interface SessionCompaction {
  text: string;
  /** Number of original messages represented by this summary. */
  throughMessageCount: number;
  updatedAt: string;
}

export interface AgentSessionProps {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  messages: SessionMessage[];
  /** Profile that owns this conversation. */
  agentId: string;
  /** Parent conversation for sub-agent sessions. */
  parentId: string | null;
  /** 0 for a user conversation, 1 for a direct child. */
  depth: number;
  summary: SessionCompaction | null;
  usage: SessionUsage;
}

export interface CreateAgentSessionOptions {
  now?: Date;
  agentId?: string;
  parentId?: string | null;
  depth?: number;
}

export function emptySessionUsage(): SessionUsage {
  return {
    modelCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalDurationMs: 0,
  };
}

/**
 * A conversation with the agent. The full transcript is persisted; the
 * application layer trims or compacts it before sending anything to the model.
 */
export class AgentSession {
  private constructor(private readonly props: AgentSessionProps) {}

  static create(
    id: string,
    options: CreateAgentSessionOptions = {},
  ): AgentSession {
    const timestamp = (options.now ?? new Date()).toISOString();
    return new AgentSession({
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "active",
      messages: [],
      agentId: options.agentId ?? "assistant",
      parentId: options.parentId ?? null,
      depth: options.depth ?? 0,
      summary: null,
      usage: emptySessionUsage(),
    });
  }

  static restore(props: AgentSessionProps): AgentSession {
    return new AgentSession({
      ...props,
      messages: props.messages.map((message) => ({ ...message })),
      summary: props.summary ? { ...props.summary } : null,
      usage: { ...props.usage },
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

  get agentId(): string {
    return this.props.agentId;
  }

  get parentId(): string | null {
    return this.props.parentId;
  }

  get depth(): number {
    return this.props.depth;
  }

  get summary(): SessionCompaction | null {
    return this.props.summary;
  }

  get usage(): SessionUsage {
    return { ...this.props.usage };
  }

  /** Messages not yet represented by the compacted summary. */
  get workingMessages(): readonly SessionMessage[] {
    return this.props.messages.slice(
      this.props.summary?.throughMessageCount ?? 0,
    );
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

  setSummary(text: string, throughMessageCount: number): void {
    this.props.summary = {
      text,
      throughMessageCount: Math.max(
        0,
        Math.min(throughMessageCount, this.props.messages.length),
      ),
      updatedAt: this.timestamp(),
    };
    this.touch();
  }

  clearSummary(): void {
    this.props.summary = null;
    this.touch();
  }

  recordUsage(usage: LlmUsage): void {
    this.props.usage.modelCalls += 1;
    this.props.usage.promptTokens += usage.promptTokens;
    this.props.usage.completionTokens += usage.completionTokens;
    this.props.usage.totalDurationMs += usage.totalDurationMs;
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
      summary: this.props.summary ? { ...this.props.summary } : null,
      usage: { ...this.props.usage },
    };
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private touch(): void {
    this.props.updatedAt = this.timestamp();
  }
}
