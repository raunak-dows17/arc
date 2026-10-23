import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SandboxViolationError } from "../../domain/errors/agent.errors.js";
import type { SandboxEntry, SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { PathPolicy } from "../../domain/services/path-policy.js";
import {
  assertPortableRelativePath,
  pathComparisonKey,
} from "../../domain/services/portable-path.js";

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const RESERVED_STATE_DIRS = new Set([".agent", ".arc"]);

/**
 * Filesystem sandbox rooted at a single directory. Every path is normalised,
 * contained, and checked for symbolic-link escapes; the reserved `.agent`
 * state directory is hidden from agent tools.
 */
export class NodeFsSandboxAdapter implements SandboxPort {
  private constructor(
    public readonly root: string,
    private readonly policy?: PathPolicy,
  ) {}

  static async create(
    directory: string,
    policy?: PathPolicy,
  ): Promise<NodeFsSandboxAdapter> {
    const absolute = path.resolve(directory);
    await mkdir(absolute, { recursive: true });
    return new NodeFsSandboxAdapter(await realpath(absolute), policy);
  }

  async list(relativeDir = "."): Promise<SandboxEntry[]> {
    const directory = await this.resolveSafe(relativeDir, "read");
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      throw new SandboxViolationError(`"${relativeDir}" is not a directory.`);
    }

    const dirents = await readdir(directory, { withFileTypes: true });
    const entries: SandboxEntry[] = [];

    for (const dirent of dirents) {
      if (RESERVED_STATE_DIRS.has(dirent.name.toLowerCase())) {
        continue;
      }
      const fullPath = path.join(directory, dirent.name);
      const relativePath = path.relative(this.root, fullPath).split(path.sep).join("/");

      if (dirent.isDirectory()) {
        entries.push({
          path: relativePath,
          name: dirent.name,
          type: "directory",
        });
      } else if (dirent.isFile()) {
        const fileStat = await stat(fullPath);
        entries.push({
          path: relativePath,
          name: dirent.name,
          type: "file",
          sizeBytes: fileStat.size,
        });
      }

      if (entries.length >= MAX_LIST_ENTRIES) {
        break;
      }
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    return entries;
  }

  async read(relativePath: string): Promise<string> {
    const file = await this.resolveSafe(relativePath, "read");
    const fileStat = await stat(file);
    if (!fileStat.isFile()) {
      throw new SandboxViolationError(`"${relativePath}" is not a file.`);
    }
    if (fileStat.size > MAX_READ_BYTES) {
      throw new SandboxViolationError(
        `File "${relativePath}" is ${fileStat.size} bytes; the read limit is ${MAX_READ_BYTES} bytes.`,
      );
    }

    const content = await readFile(file, "utf8");
    if (content.includes("\0")) {
      throw new SandboxViolationError(
        `"${relativePath}" looks like a binary file and cannot be read as text.`,
      );
    }
    return content;
  }

  async write(relativePath: string, content: string): Promise<{ bytes: number }> {
    const target = await this.resolveSafe(relativePath, "write");
    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > MAX_WRITE_BYTES) {
      throw new SandboxViolationError(
        `Refusing to write ${bytes} bytes; the write limit is ${MAX_WRITE_BYTES} bytes.`,
      );
    }

    try {
      const existing = await lstat(target);
      if (existing.isDirectory()) {
        throw new SandboxViolationError(`"${relativePath}" is a directory.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { bytes };
  }

  private async resolveSafe(
    relativePath: string,
    mode: "read" | "write",
  ): Promise<string> {
    const input = relativePath.trim() === "" ? "." : relativePath.trim();

    assertPortableRelativePath(input);

    if (path.isAbsolute(input)) {
      throw new SandboxViolationError(
        `Absolute paths are not allowed: "${input}". Use a path relative to the sandbox root.`,
      );
    }

    const normalized = path.normalize(input);
    const [firstSegment] = normalized.split(path.sep);
    if (firstSegment && RESERVED_STATE_DIRS.has(firstSegment.toLowerCase())) {
      throw new SandboxViolationError(
        `The "${firstSegment}" directory is reserved for agent state.`,
      );
    }
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
      throw new SandboxViolationError(`Path escapes the sandbox: "${input}".`);
    }

    if (this.policy) {
      if (mode === "write") {
        this.policy.assertWritable(input);
      } else {
        this.policy.assertReadable(input);
      }
    }

    const resolved = path.resolve(this.root, normalized);
    if (!this.isInside(resolved)) {
      throw new SandboxViolationError(`Path escapes the sandbox: "${input}".`);
    }

    await this.assertNoSymlinkEscape(resolved, input);

    if (this.policy) {
      const realProbe = await this.realProbe(resolved);
      const realRelative =
        path.relative(this.root, realProbe).split(path.sep).join("/") || ".";
      if (mode === "write") {
        this.policy.assertWritable(realRelative);
      } else {
        this.policy.assertReadable(realRelative);
      }
    }

    return resolved;
  }

  private isInside(candidate: string): boolean {
    const candidateKey = pathComparisonKey(candidate);
    const rootKey = pathComparisonKey(this.root);
    return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
  }

  private async assertNoSymlinkEscape(
    resolved: string,
    original: string,
  ): Promise<void> {
    const realProbe = await this.realProbe(resolved);
    if (!this.isInside(realProbe)) {
      throw new SandboxViolationError(
        `Path escapes the sandbox through a symbolic link: "${original}".`,
      );
    }

    const realRelative = path.relative(this.root, realProbe);
    const [realFirst] = realRelative.split(path.sep);
    if (realFirst && RESERVED_STATE_DIRS.has(realFirst.toLowerCase())) {
      throw new SandboxViolationError(
        `The "${realFirst}" directory is reserved for agent state.`,
      );
    }
  }

  /** Real path of the target, or of its nearest existing ancestor. */
  private async realProbe(resolved: string): Promise<string> {
    let probe = resolved;
    while (true) {
      try {
        await lstat(probe);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        const parent = path.dirname(probe);
        if (parent === probe) {
          break;
        }
        probe = parent;
      }
    }

    return realpath(probe);
  }
}
