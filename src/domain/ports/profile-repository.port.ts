import type { AgentProfile } from "../entities/agent-profile.js";

export interface AgentProfileRepositoryPort {
  get(id: string): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
  /** Re-read user profile files. */
  reload(): Promise<void>;
}
