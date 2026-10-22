import type { UUID } from "../../shared/types/common.types.js";

export interface RunAgentDTO {
  agentId: UUID;
  objective: string;
}
