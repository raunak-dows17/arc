import type { UUID } from "../../shared/types/common.types.js";

export interface VectorDocument {
  id?: UUID;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

export interface VectorQueryRequirements {
  text: string;
  limit?: number;
  filter?: Record<string, any>;
}

export interface VectorStorePort {
  // To save experience or knowledge in the long term memory
  addDocument(document: VectorDocument): Promise<void>;

  // To search relevant past memory or to search context
  searchSimilar(query: VectorQueryRequirements): Promise<VectorDocument[]>;

  // To delete all past memeories of an agent
  clearStore(filter: Record<string, any>): Promise<void>;
}
