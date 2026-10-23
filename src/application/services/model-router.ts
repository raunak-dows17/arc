import type {
  ModelSelection,
  ModelSettings,
} from "../../infrastructure/config/models.js";

export type ModelTask =
  | "main"
  | "research"
  | "coding"
  | "triage"
  | "compaction";

export type ModelCatalog = ModelSettings["roles"];

/**
 * Chooses a provider/model pair by task. The router does not create provider
 * clients; the routing adapter resolves the pair at call time.
 */
export class ModelRouter {
  constructor(private readonly catalog: ModelCatalog) {}

  resolve(task: ModelTask): ModelSelection {
    return { ...this.catalog[task] };
  }

  resolveForProfile(profileId: string): ModelSelection {
    if (["coder", "coding", "engineer", "developer"].includes(profileId)) {
      return this.resolve("coding");
    }
    if (["research", "researcher", "analyst"].includes(profileId)) {
      return this.resolve("research");
    }
    return this.resolve("main");
  }

  get decisionModel(): ModelSelection {
    return this.resolve("triage");
  }

  snapshot(): Readonly<ModelCatalog> {
    return {
      main: { ...this.catalog.main },
      research: { ...this.catalog.research },
      coding: { ...this.catalog.coding },
      triage: { ...this.catalog.triage },
      compaction: { ...this.catalog.compaction },
    };
  }
}
