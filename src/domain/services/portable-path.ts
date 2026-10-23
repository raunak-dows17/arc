import { SandboxViolationError } from "../errors/agent.errors.js";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Rejects path shapes that are unsafe on Windows. Applied on every platform so
 * macOS development cannot hide a Windows-only escape.
 */
export function assertPortableRelativePath(input: string): void {
  if (input !== input.trim()) {
    throw new SandboxViolationError(
      `Path must not start or end with whitespace: "${input}".`,
    );
  }
  const trimmed = input;
  if (trimmed.includes("\0")) {
    throw new SandboxViolationError("Path contains a null byte.");
  }
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    throw new SandboxViolationError(
      `UNC and device paths are not allowed: "${input}".`,
    );
  }
  if (/^[A-Za-z]:/.test(trimmed)) {
    throw new SandboxViolationError(
      `Drive-letter paths are not allowed: "${input}". Use a path relative to the workspace.`,
    );
  }
  if (trimmed.includes(":")) {
    throw new SandboxViolationError(
      `Alternate data streams are not allowed in path "${input}".`,
    );
  }

  for (const segment of trimmed.split(/[\\/]+/)) {
    if (!segment || segment === "." || segment === "..") {
      continue;
    }
    if (/[ .]$/.test(segment)) {
      throw new SandboxViolationError(
        `Path segment "${segment}" ends with a dot or space, which is ambiguous on Windows.`,
      );
    }
    if (/[\u0000-\u001f<>"|?*]/.test(segment)) {
      throw new SandboxViolationError(
        `Path segment "${segment}" contains characters that are reserved on Windows.`,
      );
    }
    const base = segment.split(".")[0]?.toUpperCase() ?? "";
    if (WINDOWS_RESERVED_NAMES.has(base)) {
      throw new SandboxViolationError(
        `Path segment "${segment}" is a reserved Windows device name.`,
      );
    }
  }
}

/**
 * Canonical comparison key for containment checks. Windows paths are
 * case-insensitive; macOS is normally case-insensitive too, but keeping this
 * platform-aware avoids surprising behaviour on case-sensitive volumes.
 */
export function pathComparisonKey(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? value.toLowerCase() : value;
}
