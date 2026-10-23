import type { SessionUsage } from "./agent-session.js";

export type SubAgentStatus = "running" | "completed" | "failed" | "cancelled";

export interface SubAgentRunProps {
  id: string;
  parentSessionId: string;
  childSessionId: string;
  parentAgentId: string;
  agentId: string;
  task: string;
  depth: number;
  status: SubAgentStatus;
  createdAt: string;
  finishedAt: string | null;
  summary: string;
  error: string | null;
  steps: number;
  usage: SessionUsage;
}

/**
 * A persisted record of one delegation. The child transcript lives in the
 * normal session store; this record is the compact index used by /tasks.
 */
export type CreateSubAgentRunProps = Omit<
  SubAgentRunProps,
  "status" | "finishedAt" | "summary" | "error" | "steps" | "usage"
> & {
  usage?: SessionUsage;
};

export class SubAgentRun {
  private constructor(private readonly props: SubAgentRunProps) {}

  static create(props: CreateSubAgentRunProps): SubAgentRun {
    return new SubAgentRun({
      ...props,
      status: "running",
      finishedAt: null,
      summary: "",
      error: null,
      steps: 0,
      usage:
        props.usage ??
        ({
          modelCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalDurationMs: 0,
        } satisfies SessionUsage),
    });
  }

  static restore(props: SubAgentRunProps): SubAgentRun {
    return new SubAgentRun({
      ...props,
      usage: { ...props.usage },
    });
  }

  get id(): string {
    return this.props.id;
  }

  get parentSessionId(): string {
    return this.props.parentSessionId;
  }

  get childSessionId(): string {
    return this.props.childSessionId;
  }

  get parentAgentId(): string {
    return this.props.parentAgentId;
  }

  get agentId(): string {
    return this.props.agentId;
  }

  get task(): string {
    return this.props.task;
  }

  get depth(): number {
    return this.props.depth;
  }

  get status(): SubAgentStatus {
    return this.props.status;
  }

  get createdAt(): string {
    return this.props.createdAt;
  }

  get finishedAt(): string | null {
    return this.props.finishedAt;
  }

  get summary(): string {
    return this.props.summary;
  }

  get error(): string | null {
    return this.props.error;
  }

  get steps(): number {
    return this.props.steps;
  }

  get usage(): SessionUsage {
    return { ...this.props.usage };
  }

  finish(input: {
    status: Exclude<SubAgentStatus, "running">;
    summary: string;
    error?: string | null;
    steps: number;
    usage: SessionUsage;
  }): void {
    this.props.status = input.status;
    this.props.summary = input.summary;
    this.props.error = input.error ?? null;
    this.props.steps = input.steps;
    this.props.usage = { ...input.usage };
    this.props.finishedAt = new Date().toISOString();
  }

  toProps(): SubAgentRunProps {
    return { ...this.props, usage: { ...this.props.usage } };
  }
}
