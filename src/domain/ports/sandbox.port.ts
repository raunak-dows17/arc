export interface SandboxEntry {
  /** Path relative to the sandbox root, using forward slashes. */
  path: string;
  name: string;
  type: "file" | "directory";
  sizeBytes?: number;
}

/**
 * The agent's entire filesystem world. Implementations must reject paths that
 * resolve outside the sandbox.
 */
export interface SandboxPort {
  readonly root: string;
  list(relativeDir?: string): Promise<SandboxEntry[]>;
  read(relativePath: string): Promise<string>;
  write(relativePath: string, content: string): Promise<{ bytes: number }>;
}
