import { DecisionParseError } from "../../domain/errors/agent.errors.js";

export type ProviderFailureKind =
  | "rate-limit"
  | "auth"
  | "timeout"
  | "context"
  | "server"
  | "unknown";

export interface ProviderHealthSnapshot {
  provider: string;
  model: string;
  available: boolean;
  failures: number;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  latencyMs: number | null;
}

interface HealthState {
  failures: number;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  latencyMs: number | null;
}

const DEFAULT_COOLDOWNS: Record<ProviderFailureKind, number> = {
  "rate-limit": 60_000,
  auth: 5 * 60_000,
  timeout: 15_000,
  context: 0,
  server: 30_000,
  unknown: 10_000,
};

/**
 * Tracks provider/model health so a 429 or a dead local runtime does not get
 * retried on every agent step. Cooldowns are in-memory and intentionally
 * short-lived; a restart is a clean slate.
 */
export class ProviderHealthRegistry {
  private readonly states = new Map<string, HealthState>();

  isAvailable(
    provider: string,
    model?: string,
    now = Date.now(),
  ): boolean {
    return (
      this.state(provider, "*").cooldownUntil === null ||
      this.state(provider, "*").cooldownUntil! <= now
    ) && (model === undefined ||
      this.state(provider, model).cooldownUntil === null ||
      this.state(provider, model).cooldownUntil! <= now);
  }

  recordSuccess(
    provider: string,
    model: string,
    latencyMs: number,
  ): void {
    const state = this.state(provider, model);
    state.failures = 0;
    state.cooldownUntil = null;
    state.lastError = null;
    state.lastSuccessAt = Date.now();
    state.latencyMs = latencyMs;
  }

  /** Marks a provider unavailable until ARC restarts (missing key, missing binary). */
  markUnavailable(provider: string, model: string, message: string): void {
    const state = this.state(provider, model);
    state.lastError = message;
    state.cooldownUntil = Number.MAX_SAFE_INTEGER;
  }

  recordFailure(
    provider: string,
    model: string,
    error: unknown,
    now = Date.now(),
  ): ProviderFailureKind {
    if (error instanceof DecisionParseError) {
      // The provider answered; the model produced invalid JSON. That is a
      // model-quality signal, not a reason to cool down the provider.
      return "unknown";
    }

    const kind = classifyFailure(error);
    const state = this.state(provider, model);
    state.failures += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
    const cooldown = DEFAULT_COOLDOWNS[kind];
    if (cooldown > 0) {
      state.cooldownUntil = now + cooldown;
    }
    return kind;
  }

  snapshot(provider: string, model: string): ProviderHealthSnapshot {
    const state = this.state(provider, model);
    return {
      provider,
      model,
      available: this.isAvailable(provider, model),
      failures: state.failures,
      cooldownUntil: state.cooldownUntil,
      lastError: state.lastError,
      lastSuccessAt: state.lastSuccessAt,
      latencyMs: state.latencyMs,
    };
  }

  private state(provider: string, model: string): HealthState {
    const key = `${provider}/${model}`;
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }
    const created: HealthState = {
      failures: 0,
      cooldownUntil: null,
      lastError: null,
      lastSuccessAt: null,
      latencyMs: null,
    };
    this.states.set(key, created);
    return created;
  }
}

export function classifyFailure(error: unknown): ProviderFailureKind {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/429|rate.?limit|too many requests|quota|resource.?exhausted/.test(message)) {
    return "rate-limit";
  }
  if (/401|403|unauthori[sz]ed|forbidden|api key|authentication/.test(message)) {
    return "auth";
  }
  if (/timeout|timed out|abort/.test(message)) {
    return "timeout";
  }
  if (/context.?length|maximum context|token limit|too many tokens/.test(message)) {
    return "context";
  }
  if (/500|502|503|504|unavailable|could not reach|connection refused/.test(message)) {
    return "server";
  }
  return "unknown";
}
