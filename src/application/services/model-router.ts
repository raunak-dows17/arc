import type {
  ModelSelection,
  ModelSettings,
} from "../../infrastructure/config/models.js";
import type { ModelTask } from "../../infrastructure/models/model-catalog.js";
import type {
  ModelOrchestrator,
  ModelPlan,
  ModelRoutingRequest,
} from "./model-orchestrator.js";

export type { ModelTask };

export type ModelCatalog = ModelSettings["roles"];

/**
 * Chooses a provider/model pair by task. When an orchestrator is present it
 * applies mode, health, fit, and quality policy; otherwise it preserves the
 * original explicit role routing.
 */
export class ModelRouter {
  private pin?: ModelSelection;

  constructor(
    private readonly catalog: ModelCatalog,
    private readonly orchestrator?: ModelOrchestrator,
  ) {}

  /** Pins a model for this process/session. The orchestrator still enforces the hard mode and privacy boundary. */
  setPin(selection: ModelSelection | null): void {
    this.pin = selection ?? undefined;
  }

  resolve(task: ModelTask): ModelSelection {
    if (this.orchestrator) {
      return this.orchestrator.plan({
        ...this.request(task),
        ...(this.pin ? { explicit: this.pin } : {}),
      }).primary;
    }
    if (this.pin) {
      return { ...this.pin };
    }
    return { ...this.catalog[task] };
  }

  plan(
    task: ModelTask,
    request: Partial<Omit<ModelRoutingRequest, "task">> = {},
  ): ModelPlan {
    if (!this.orchestrator) {
      const selection = this.resolve(task);
      return {
        primary: selection,
        fallbacks: [],
        reason: "Explicit role routing.",
        local: false,
      };
    }
    const merged = { ...this.request(task), ...request };
    if (this.pin && !merged.explicit) {
      merged.explicit = this.pin;
    }
    return this.orchestrator.plan(merged);
  }

  resolveForProfile(profileId: string): ModelSelection {
    return this.planForProfile(profileId).primary;
  }

  planForProfile(
    profileId: string,
    request: Partial<Omit<ModelRoutingRequest, "task">> = {},
  ): ModelPlan {
    return this.plan(this.taskForProfile(profileId), request);
  }

  private taskForProfile(profileId: string): ModelTask {
    if (["coder", "coding", "engineer", "developer"].includes(profileId)) {
      return "coding";
    }
    if (["research", "researcher", "analyst"].includes(profileId)) {
      return "research";
    }
    return "main";
  }

  get decisionModel(): ModelSelection {
    return this.resolve("triage");
  }

  snapshot(): ModelSettings["roles"] {
    return {
      main: this.resolve("main"),
      research: this.resolve("research"),
      coding: this.resolve("coding"),
      triage: this.resolve("triage"),
      compaction: this.resolve("compaction"),
    };
  }

  private request(task: ModelTask): ModelRoutingRequest {
    return {
      task,
      requiresTools: task !== "compaction" && task !== "triage",
    };
  }
}
