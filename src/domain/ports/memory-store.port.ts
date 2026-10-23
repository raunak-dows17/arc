export type MemoryScope = "long-term" | "daily";

export interface MemoryCore {
  user: string;
  longTerm: string;
  recentDaily: string;
}

export interface MemorySearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface MemoryStorePort {
  /** Create ARC_HOME/memory and default Markdown files if needed. */
  initialize(): Promise<void>;
  readCore(now?: Date): Promise<MemoryCore>;
  appendDaily(entry: string, now?: Date): Promise<{ path: string; bytes: number }>;
  remember(
    content: string,
    scope: MemoryScope,
    now?: Date,
  ): Promise<{ path: string; bytes: number }>;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  /** Read a line range of a memory file by path relative to the memory root. */
  get(
    relativePath: string,
    startLine?: number,
    lineCount?: number,
  ): Promise<string>;
}
