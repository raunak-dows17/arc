import type { SubAgentRun } from "../entities/sub-agent-run.js";

export interface SubAgentRepositoryPort {
  save(run: SubAgentRun): Promise<void>;
  load(id: string): Promise<SubAgentRun | null>;
  list(limit?: number): Promise<SubAgentRun[]>;
  listByParent(parentSessionId: string, limit?: number): Promise<SubAgentRun[]>;
}
