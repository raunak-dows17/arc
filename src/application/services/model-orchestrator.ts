import type {
  ModelSelection,
  ModelSettings,
  ModelStrategy,
} from "../../infrastructure/config/models.js";
import type { ModelMode } from "../../infrastructure/config/models.js";
import {
  ModelCatalog,
  type ModelDescriptor,
  type ModelTask,
} from "../../infrastructure/models/model-catalog.js";
import {
  contextTokensFromChars,
  estimateLocalModelFit,
} from "../../infrastructure/models/model-fit.js";
import type { ProviderHealthRegistry } from "../../infrastructure/models/provider-health.js";
import type { DeviceProfile } from "../../infrastructure/models/device-profile.js";

export interface ModelRoutingRequest {
  task: ModelTask;
  profileId?: string;
  contextChars?: number;
  requiresTools?: boolean;
  sensitive?: boolean;
  /** An explicit user pin. It wins inside the mode/privacy boundary. */
  explicit?: ModelSelection;
}

export interface ModelPlan {
  primary: ModelSelection;
  fallbacks: ModelSelection[];
  reason: string;
  local: boolean;
  estimatedPrefillMs?: number;
}

export interface ModelOrchestratorOptions {
  settings: ModelSettings;
  catalog?: ModelCatalog;
  health?: ProviderHealthRegistry;
  device?: DeviceProfile;
  now?: () => number;
}

export class ModelRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRoutingError";
  }
}

const QUALITY_FLOORS: Record<ModelTask, number> = {
  triage: 0.35,
  compaction: 0.4,
  main: 0.55,
  coding: 0.6,
  research: 0.7,
};

/**
 * Local models are preferred when they are close enough to the best cloud
 * model for the task. Research and complex work still escalate to cloud when
 * the local pool is materially weaker.
 */
const LOCAL_PREFERENCE_MARGIN: Record<ModelTask, number> = {
  triage: 1,
  compaction: 1,
  main: 0.3,
  coding: 0.1,
  research: 0.05,
};

export class ModelOrchestrator {
  private readonly catalog: ModelCatalog;
  private readonly now: () => number;

  constructor(private readonly options: ModelOrchestratorOptions) {
    this.catalog = options.catalog ?? new ModelCatalog(options.settings);
    this.now = options.now ?? Date.now;
  }

  plan(request: ModelRoutingRequest): ModelPlan {
    const mode = this.options.settings.mode;
    const strategy = this.options.settings.strategy;
    const contextTokens = contextTokensFromChars(request.contextChars ?? 16_000);
    const candidates = this.catalog.list();
    const explicitDescriptor = request.explicit
      ? this.catalog.describe(request.explicit)
      : undefined;

    const eligible = candidates.filter((candidate) =>
      this.isEligible(candidate, request, contextTokens, mode),
    );

    if (request.explicit) {
      if (
        explicitDescriptor &&
        this.isEligible(explicitDescriptor, request, contextTokens, mode)
      ) {
        return this.planForExplicit(explicitDescriptor, eligible, request);
      }
      if (explicitDescriptor) {
        // A pin that violates the hard boundary is ignored rather than
        // silently crossing a local/cloud or privacy line.
        return this.planFromPool(eligible, request, contextTokens, mode, strategy, [
          `Explicit pin ${label(request.explicit)} was outside the ${mode} boundary and was ignored.`,
        ]);
      }
    }

    return this.planFromPool(eligible, request, contextTokens, mode, strategy, []);
  }

  private planForExplicit(
    explicit: ModelDescriptor,
    eligible: readonly ModelDescriptor[],
    request: ModelRoutingRequest,
  ): ModelPlan {
    const fallbacks = rank(eligible.filter((item) => !same(item, explicit)), request)
      .slice(0, 3)
      .map(toSelection);
    return {
      primary: toSelection(explicit),
      fallbacks,
      reason: `Explicit pin ${label(explicit)} is available and respects the ${this.options.settings.mode} boundary.`,
      local: explicit.local,
    };
  }

  private planFromPool(
    eligible: readonly ModelDescriptor[],
    request: ModelRoutingRequest,
    contextTokens: number,
    mode: ModelMode,
    strategy: ModelStrategy,
    prefixReasons: readonly string[],
  ): ModelPlan {
    if (eligible.length === 0) {
      throw new ModelRoutingError(
        `No model is available for ${request.task} in ${mode} mode. ` +
          "Check ARC_HOME/models.json, provider keys, local runtimes, and host memory.",
      );
    }

    const floor = QUALITY_FLOORS[request.task];
    const aboveFloor = eligible.filter(
      (candidate) => taskScore(candidate, request.task) >= floor,
    );
    const pool = aboveFloor.length > 0 ? aboveFloor : eligible;
    const relaxed = aboveFloor.length === 0;
    const ranked = rank(pool, request, strategy);
    const primary = ranked[0];
    if (!primary) {
      throw new ModelRoutingError(
        `No model could be selected for ${request.task}.`,
      );
    }

    const fit =
      primary.local && this.options.device
        ? estimateLocalModelFit(
            this.options.device,
            primary.model,
            contextTokens,
          )
        : undefined;
    const reasons = [...prefixReasons];
    if (relaxed) {
      reasons.push(
        `No model met the ${floor.toFixed(2)} ${request.task} quality floor; using the best available.`,
      );
    }
    reasons.push(
      `${primary.local ? "Local" : "Cloud"} ${label(primary)} scored ${taskScore(primary, request.task).toFixed(2)} for ${request.task}.`,
    );
    if (fit) {
      reasons.push(
        fit.fits
          ? `Local fit: ~${gib(fit.requirements.totalBytes)} of ${gib(fit.availableBytes)} usable.`
          : "Local fit is tight; cloud fallback is recommended.",
      );
    }

    return {
      primary: toSelection(primary),
      fallbacks: ranked
        .filter((candidate) => !same(candidate, primary))
        .slice(0, 3)
        .map(toSelection),
      reason: reasons.join(" "),
      local: primary.local,
      ...(fit ? { estimatedPrefillMs: fit.estimatedPrefillMs } : {}),
    };
  }

  private isEligible(
    candidate: ModelDescriptor,
    request: ModelRoutingRequest,
    contextTokens: number,
    mode: ModelMode,
  ): boolean {
    if (mode === "local" && !candidate.local) {
      return false;
    }
    if (mode === "cloud" && candidate.local) {
      return false;
    }
    if (
      request.sensitive &&
      this.options.settings.privacy.sensitiveData === "local" &&
      !candidate.sensitiveDataAllowed
    ) {
      return false;
    }
    if (request.requiresTools && !candidate.toolCalling) {
      return false;
    }
    if (contextTokens > candidate.contextWindow) {
      return false;
    }
    if (
      this.options.health &&
      !this.options.health.isAvailable(candidate.provider, candidate.model, this.now())
    ) {
      return false;
    }
    if (candidate.local && this.options.device) {
      const fit = estimateLocalModelFit(
        this.options.device,
        candidate.model,
        contextTokens,
      );
      if (!fit.fits) {
        return false;
      }
    }
    return true;
  }
}

function rank(
  candidates: readonly ModelDescriptor[],
  request: ModelRoutingRequest,
  strategy: ModelStrategy = "balanced",
): ModelDescriptor[] {
  if (candidates.length === 0) {
    return [];
  }
  const scored = candidates.map((candidate) => ({
    candidate,
    score: taskScore(candidate, request.task),
  }));
  const best = Math.max(...scored.map((entry) => entry.score));
  const margin =
    strategy === "quality"
      ? 0
      : strategy === "cost"
        ? LOCAL_PREFERENCE_MARGIN[request.task] + 0.15
        : LOCAL_PREFERENCE_MARGIN[request.task];
  const localNearBest = scored.filter(
    (entry) => entry.candidate.local && entry.score >= best - margin,
  );
  const pool = localNearBest.length > 0 ? localNearBest : scored;

  return pool
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (Math.abs(scoreDelta) > 0.001) {
        return scoreDelta;
      }
      const costDelta = left.candidate.costTier - right.candidate.costTier;
      if (costDelta !== 0) {
        return costDelta;
      }
      return right.candidate.speed - left.candidate.speed;
    })
    .map((entry) => entry.candidate);
}

function taskScore(candidate: ModelDescriptor, task: ModelTask): number {
  switch (task) {
    case "triage":
      return candidate.triage;
    case "compaction":
      return candidate.speed * 0.55 + candidate.quality * 0.45;
    case "coding":
      return candidate.coding;
    case "research":
      return candidate.quality;
    case "main":
      return candidate.quality;
  }
}

function toSelection(descriptor: ModelDescriptor): ModelSelection {
  return { provider: descriptor.provider, model: descriptor.model };
}

function same(left: ModelDescriptor, right: ModelDescriptor): boolean {
  return left.provider === right.provider && left.model === right.model;
}

function label(selection: ModelSelection): string {
  return `${selection.provider}/${selection.model}`;
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
