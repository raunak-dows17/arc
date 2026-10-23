export type ApprovalChannel = "cli" | "telegram" | "scheduler";

export type ApprovalRisk = "read" | "workspace-write" | "network" | "shell";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: unknown;
  risk: ApprovalRisk;
  reason: string;
  channel: ApprovalChannel;
  sessionId: string;
  turnId?: string;
  /** Unix epoch milliseconds. */
  expiresAt: number;
}

export interface ApprovalDecision {
  approved: boolean;
  decidedBy: string;
  reason?: string;
}

/**
 * A human approval boundary. Implementations must fail closed when no human is
 * available; background schedulers must never approve their own actions.
 */
export interface ApprovalPort {
  request(
    request: Omit<ApprovalRequest, "id" | "expiresAt">,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision>;
}
