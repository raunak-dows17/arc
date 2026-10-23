import type {
  ApprovalChannel,
  ApprovalRisk,
} from "./approval.port.js";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema describing the accepted arguments. */
  parameters: Record<string, unknown>;
  /** Defaults to "read" for tools that predate risk metadata. */
  risk?: ApprovalRisk;
  /** Defaults to false. Set true for shell, network-write, and external actions. */
  requiresApproval?: boolean;
}

export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  depth: number;
  /** Skills allowed for the active profile; "*" means all. */
  allowedSkills?: "*" | readonly string[];
  /** Where this turn originated. */
  channel?: ApprovalChannel;
  turnId?: string;
  approvalId?: string;
  origin?: string;
  signal?: AbortSignal;
}

export interface ToolPort {
  getDefinition(): ToolDefinition;
  execute(args: unknown, context?: ToolExecutionContext): Promise<string>;
}
