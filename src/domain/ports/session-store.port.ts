import type { AgentSession } from "../entities/agent-session.js";

export interface SessionSummary {
  id: string;
  updatedAt: string;
  messageCount: number;
  status: AgentSession["status"];
  agentId: string;
  parentId: string | null;
}

export interface SessionStorePort {
  save(session: AgentSession): Promise<void>;
  load(id: string): Promise<AgentSession | null>;
  /** Most recently updated root (non-sub-agent) session, if any. */
  latest(): Promise<AgentSession | null>;
  list(): Promise<SessionSummary[]>;
}
