import { SandboxViolationError } from "../errors/agent.errors.js";

export interface PathPolicyOptions {
  readDeny?: readonly string[];
  writeDeny?: readonly string[];
}

const DEFAULT_READ_DENY = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "secrets",
  "secrets/**",
  "**/secrets",
  "**/secrets/**",
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
  ".ssh",
  ".ssh/**",
  "**/.ssh",
  "**/.ssh/**",
] as const;

const DEFAULT_WRITE_DENY = DEFAULT_READ_DENY;

/**
 * Least-privilege path rules for sensitive files that may live in a workspace.
 * It complements (and never replaces) the sandbox's containment checks.
 */
export class PathPolicy {
  private readonly readMatchers: RegExp[];
  private readonly writeMatchers: RegExp[];

  constructor(options: PathPolicyOptions = {}) {
    this.readMatchers = (options.readDeny ?? DEFAULT_READ_DENY).map(globToRegExp);
    this.writeMatchers = (options.writeDeny ?? DEFAULT_WRITE_DENY).map(
      globToRegExp,
    );
  }

  isReadable(relativePath: string): boolean {
    const normalized = normalize(relativePath);
    return !this.readMatchers.some((matcher) => matcher.test(normalized));
  }

  isWritable(relativePath: string): boolean {
    const normalized = normalize(relativePath);
    return !this.writeMatchers.some((matcher) => matcher.test(normalized));
  }

  assertReadable(relativePath: string): void {
    if (!this.isReadable(relativePath)) {
      throw new SandboxViolationError(
        `Access to sensitive path "${relativePath}" is blocked by policy.`,
      );
    }
  }

  assertWritable(relativePath: string): void {
    if (!this.isWritable(relativePath)) {
      throw new SandboxViolationError(
        `Writing to sensitive path "${relativePath}" is blocked by policy.`,
      );
    }
  }
}

function normalize(relativePath: string): string {
  const cleaned = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");

  const segments: string[] = [];
  for (const segment of cleaned.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function globToRegExp(pattern: string): RegExp {
  const glob = pattern.replace(/\\/g, "/");
  let source = "";
  let index = 0;

  while (index < glob.length) {
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (glob.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }

    const character = glob[index] ?? "";
    if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    index += 1;
  }

  return new RegExp(`^${source}$`);
}
