import type { SessionUsage } from "../entities/agent-session.js";

export interface SubAgentRequest {
  parentSessionId: string;
  parentAgentId: string;
  parentDepth: number;
  agentId: string;
  task: string;
  context?: string;
  signal?: AbortSignal;
}

export interface SubAgentResult {
  runId: string;
  childSessionId: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  steps: number;
  usage: SessionUsage;
}

/**
 * Application boundary used by the run_agent tool. Implementations spawn a
 * child conversation with an isolated context and a restricted profile.
 */
export interface SubAgentRunnerPort {
  run(request: SubAgentRequest): Promise<SubAgentResult>;
}
