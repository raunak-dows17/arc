import type {
  SandboxEntry,
  SandboxPort,
} from "../../domain/ports/sandbox.port.js";
import type { PathPolicy } from "../../domain/services/path-policy.js";

/**
 * Applies sensitive-path rules around any sandbox implementation. Directory
 * listings hide blocked entries so the agent is not even shown their names.
 */
export class PolicyEnforcingSandbox implements SandboxPort {
  constructor(
    private readonly inner: SandboxPort,
    private readonly policy: PathPolicy,
  ) {}

  get root(): string {
    return this.inner.root;
  }

  async list(relativeDir = "."): Promise<SandboxEntry[]> {
    const entries = await this.inner.list(relativeDir);
    return entries.filter((entry) => this.policy.isReadable(entry.path));
  }

  async read(relativePath: string): Promise<string> {
    this.policy.assertReadable(relativePath);
    return this.inner.read(relativePath);
  }

  async write(
    relativePath: string,
    content: string,
  ): Promise<{ bytes: number }> {
    this.policy.assertWritable(relativePath);
    return this.inner.write(relativePath, content);
  }
}
