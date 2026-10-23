export type ModelTask = "main" | "research" | "coding" | "compaction";

export interface ModelCatalog {
  main: string;
  research: string;
  coding: string;
  decision: string;
}

/**
 * Chooses a local model by task. The router does not load models itself;
 * callers pass the selected name to the Ollama adapter, and the serialized
 * adapter guarantees only one inference runs at a time.
 */
export class ModelRouter {
  constructor(private readonly catalog: ModelCatalog) {}

  resolve(task: ModelTask): string {
    switch (task) {
      case "coding":
        return this.catalog.coding;
      case "research":
        return this.catalog.research;
      case "compaction":
      case "main":
        return this.catalog.main;
    }
  }

  resolveForProfile(profileId: string): string {
    if (["coder", "coding", "engineer", "developer"].includes(profileId)) {
      return this.catalog.coding;
    }
    if (["research", "researcher", "analyst"].includes(profileId)) {
      return this.catalog.research;
    }
    return this.catalog.main;
  }

  get decisionModel(): string {
    return this.catalog.decision;
  }

  snapshot(): Readonly<ModelCatalog> {
    return { ...this.catalog };
  }
}
