export type AgentEventType =
  | "turn.started"
  | "turn.finished"
  | "tool.started"
  | "tool.finished"
  | "memory.written"
  | "subagent.started"
  | "subagent.finished";

export interface AgentEvent {
  type: AgentEventType;
  at: string;
  sessionId: string;
  agentId: string;
  data: Record<string, unknown>;
}

export type AgentEventListener = (event: AgentEvent) => void;

export interface EventBusPort {
  emit(
    type: AgentEventType,
    input: {
      sessionId: string;
      agentId: string;
      data?: Record<string, unknown>;
    },
  ): void;
  on(type: AgentEventType | "*", listener: AgentEventListener): () => void;
}
