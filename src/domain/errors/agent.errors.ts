/**
 * Base class for all expected agent failures. Infrastructure adapters throw
 * these so the application layer and CLI can present friendly messages.
 */
export class AgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SandboxViolationError extends AgentError {}

export class ToolValidationError extends AgentError {}

export class LlmError extends AgentError {}

export class DecisionParseError extends LlmError {}

export class DecisionModelError extends LlmError {}

export class ApprovalError extends AgentError {}

export class AgentTurnError extends AgentError {}

export class SessionStoreError extends AgentError {}

export class ProfileError extends AgentError {}

export class SkillError extends AgentError {}

export class MemoryStoreError extends AgentError {}

export class SubAgentError extends AgentError {}
