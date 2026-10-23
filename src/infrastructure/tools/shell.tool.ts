import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPort,
} from "../../domain/ports/tool.port.js";
import { singleLine } from "../../shared/text.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    command: z.string().trim().min(1).max(8_000),
    timeout_seconds: z.number().int().min(1).max(300).optional(),
  })
  .strict();

export interface ShellToolOptions {
  cwd: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  maxOutputBytes?: number;
  shellPath?: string;
}

/**
 * Approval-gated shell access. On Windows this uses PowerShell; on macOS and
 * Linux it uses the user's login shell. Every invocation is approved and runs
 * with the user's own privileges. There is no command allowlist, so the human
 * approval is the security boundary.
 */
export class ShellTool implements ToolPort {
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: ShellToolOptions) {
    this.platform = options.platform ?? process.platform;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  }

  getDefinition(): ToolDefinition {
    return {
      name: "shell",
      description:
        "Run a shell command in the workspace. On Windows this is PowerShell; on macOS/Linux it is the login shell. The command runs with the user's privileges and can reach outside the workspace, so the human must approve every invocation. Use it for builds, tests, git, and system inspection.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "Complete command to run. Non-interactive commands only; stdin is not connected.",
          },
          timeout_seconds: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: "Timeout in seconds. Defaults to the configured limit.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
      risk: "shell",
      requiresApproval: true,
      approvalMode: "always",
    };
  }

  async execute(
    rawArgs: unknown,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    if (context?.signal?.aborted) {
      return "Command cancelled before it started.";
    }

    const timeoutMs = Math.min(
      (args.timeout_seconds ?? Math.ceil(this.timeoutMs / 1_000)) * 1_000,
      300_000,
    );
    const command = shellCommand(this.platform, args.command, this.options.shellPath);

    let child: ChildProcess;
    try {
      child = spawn(command.file, command.args, {
        cwd: this.options.cwd,
        env: { ...process.env, ARC_NONINTERACTIVE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: this.platform !== "win32",
      });
    } catch (error) {
      return `Could not start the shell: ${error instanceof Error ? error.message : String(error)}`;
    }

    let stdout = "";
    let stderr = "";
    let captured = 0;
    let outputTruncated = false;
    let timedOut = false;
    let cancelled = false;

    const collect = (chunk: Buffer, destination: "stdout" | "stderr"): void => {
      if (captured >= this.maxOutputBytes) {
        outputTruncated = true;
        return;
      }
      const allowed = Math.min(
        chunk.length,
        Math.max(0, this.maxOutputBytes - captured),
      );
      const text = chunk.subarray(0, allowed).toString("utf8");
      captured += allowed;
      if (allowed < chunk.length) {
        outputTruncated = true;
      }
      if (destination === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));

    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const terminate = (): void => {
      terminateProcess(child, this.platform);
    };

    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        terminate();
        resolve("timeout");
      }, timeoutMs);
      timer.unref();
    });

    const aborted = new Promise<"abort">((resolve) => {
      if (!context?.signal) {
        return;
      }
      abortListener = () => {
        cancelled = true;
        terminate();
        resolve("abort");
      };
      context.signal.addEventListener("abort", abortListener, { once: true });
    });

    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const closed = new Promise<"closed">((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        resolve("closed");
      });
    });

    try {
      await Promise.race([closed, timeout, aborted]);
    } catch (error) {
      return `Shell command failed to start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (context?.signal && abortListener) {
        context.signal.removeEventListener("abort", abortListener);
      }
    }

    if (timedOut || cancelled) {
      await Promise.race([
        closed,
        new Promise<void>((resolve) => {
          const settleTimer = setTimeout(resolve, 2_000);
          settleTimer.unref();
        }),
      ]).catch(() => undefined);
    }

    const sections = [
      `cwd: ${this.options.cwd}`,
      `command: ${singleLine(args.command, 500)}`,
    ];
    if (timedOut) {
      sections.push(`status: timed out after ${timeoutMs} ms and was terminated`);
    } else if (cancelled) {
      sections.push("status: cancelled");
    } else {
      sections.push(
        exitCode === 0
          ? "status: exit code 0"
          : `status: exit code ${exitCode ?? "unknown"}${exitSignal ? ` (signal ${exitSignal})` : ""}`,
      );
    }
    if (stdout) {
      sections.push(`stdout:\n${stdout.trimEnd()}`);
    }
    if (stderr) {
      sections.push(`stderr:\n${stderr.trimEnd()}`);
    }
    if (outputTruncated) {
      sections.push(
        `…[output truncated at ${this.maxOutputBytes} bytes; rerun a narrower command if needed]`,
      );
    }
    if (!stdout && !stderr) {
      sections.push("(no output)");
    }
    return sections.join("\n\n");
  }
}

function shellCommand(
  platform: NodeJS.Platform,
  command: string,
  shellPath?: string,
): { file: string; args: string[] } {
  if (platform === "win32") {
    return {
      file: shellPath ?? "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
    };
  }
  return {
    file: shellPath ?? process.env.SHELL ?? "/bin/sh",
    args: ["-lc", command],
  };
}

function terminateProcess(child: ChildProcess, platform: NodeJS.Platform): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
