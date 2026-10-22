import type {
  VectorDocument,
  VectorQueryRequirements,
  VectorStorePort,
} from "../../domain/ports/vector_store.port.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

export class InMemoryVectorAdapter implements VectorStorePort {
  // Simulating internal database rows storage array matrix safely
  private readonly documentsTable: VectorDocument[] = [];

  constructor() {}

  async addDocument(document: VectorDocument): Promise<void> {
    const documentRecord: VectorDocument = {
      id: document.id || crypto.randomUUID(),
      content: document.content,
      metadata: { ...document.metadata },
      // Fallback fallback flat array vector mock signature if embedding generator pipeline isn't attached
      embedding:
        document.embedding || Array.from({ length: 4 }, () => Math.random()),
    };

    this.documentsTable.push(documentRecord);
    agentLogger.debug(
      "Successfully stored contextual document signature inside vector array cache",
      { docId: documentRecord.id },
    );
  }

  async searchSimilar(
    query: VectorQueryRequirements,
  ): Promise<VectorDocument[]> {
    agentLogger.debug(
      "Executing similarity search trace against contextual vector array cache records",
      { queryString: query.text },
    );

    if (this.documentsTable.length === 0) {
      return [];
    }

    // Filter by metadata flags if requested by structural domain rules
    let filteredRecords = this.documentsTable;
    if (query.filter) {
      filteredRecords = this.documentsTable.filter((doc) => {
        return Object.entries(query.filter!).every(
          ([key, val]) => doc.metadata[key] === val,
        );
      });
    }

    // Basic heuristic sorting mechanism for standard flat testing sequences before external embedding APIs
    const sortedMatches = [...filteredRecords].sort(() => 0.5 - Math.random());
    const matchCountLimit = query.limit || 3;

    return sortedMatches.slice(0, matchCountLimit);
  }

  async clearStore(filter: Record<string, any>): Promise<void> {
    let index = this.documentsTable.length;
    while (index--) {
      const doc = this.documentsTable[index];
      const matchCriteria = Object.entries(filter).every(
        ([key, val]) => doc?.metadata[key] === val || false,
      );
      if (matchCriteria) {
        this.documentsTable.splice(index, 1);
      }
    }
    agentLogger.info(
      "Cleared historical items out of internal memory vector store matching schema filters",
    );
  }
}
