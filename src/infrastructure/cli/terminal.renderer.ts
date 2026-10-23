import pc from "picocolors";
import type { SessionMessage } from "../../domain/entities/agent-session.js";
import type { SandboxEntry } from "../../domain/ports/sandbox.port.js";
import type { SessionSummary } from "../../domain/ports/session-store.port.js";
import type { ToolDefinition } from "../../domain/ports/tool.port.js";
import type { ToolCall } from "../../domain/value-objects/tool-call.js";
import type { ToolOutcome } from "../../application/usecases/execute-tool.usecase.js";
import { singleLine } from "../../shared/text.js";

const { bold, cyan, dim, green, red, yellow } = pc;

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface BannerInput {
  model: string;
  sandbox: string;
  sessionId: string;
  resumed: boolean;
}

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private label = "";
  private startedAt = 0;
  private readonly enabled = Boolean(process.stdout.isTTY);

  start(label: string): void {
    this.stop();
    this.label = label;
    this.startedAt = Date.now();
    if (!this.enabled) {
      return;
    }
    this.render();
    this.timer = setInterval(() => this.render(), 100);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.enabled) {
      process.stdout.write("\r\x1b[2K");
    }
  }

  private render(): void {
    const frame = FRAMES[this.frame % FRAMES.length] ?? "⠋";
    this.frame += 1;
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    process.stdout.write(
      `\r\x1b[2K${dim(`${frame} ${this.label}… ${seconds}s`)}`,
    );
  }
}

export class TerminalRenderer {
  private readonly spinner = new Spinner();

  banner(input: BannerInput): void {
    console.log();
    console.log(`  ${bold(cyan("Local Autonomous Agent"))}`);
    console.log(dim(`  model    ${input.model}`));
    console.log(dim(`  sandbox  ${input.sandbox}`));
    console.log(
      dim(
        `  session  ${input.sessionId}${input.resumed ? " (resumed)" : ""}`,
      ),
    );
    console.log(
      dim(
        "  /help for commands · Ctrl+C cancels a running turn · Ctrl+D exits",
      ),
    );
    console.log();
  }

  startThinking(): void {
    this.spinner.start("thinking");
  }

  stopThinking(): void {
    this.spinner.stop();
  }

  thought(thought: string): void {
    this.spinner.stop();
    console.log(`  ${cyan("◆")} ${dim(thought)}`);
  }

  toolCall(call: ToolCall): void {
    this.spinner.stop();
    const args = singleLine(JSON.stringify(call.args), 110);
    console.log(`  ${cyan("→")} ${cyan(call.name)} ${dim(args)}`);
  }

  toolResult(_call: ToolCall, outcome: ToolOutcome): void {
    this.spinner.stop();
    const preview = outcome.observation
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(0, 2)
      .map((line) => singleLine(line, 110))
      .join(" / ");
    const suffix = outcome.observation.split(/\r?\n/).filter(Boolean).length > 2 ? " …" : "";
    const marker = outcome.ok ? green("✓") : red("✗");
    console.log(`  ${marker} ${dim(preview)}${dim(suffix)}`);
  }

  finalAnswer(answer: string): void {
    this.spinner.stop();
    console.log();
    console.log(`  ${bold("final")}`);
    for (const line of answer.split(/\r?\n/)) {
      console.log(line.length > 0 ? `  ${line}` : "");
    }
    console.log();
  }

  history(messages: readonly SessionMessage[]): void {
    this.spinner.stop();
    if (messages.length === 0) {
      this.info("No messages in this session yet.");
      return;
    }

    const recent = messages.slice(-20);
    console.log();
    for (const [index, message] of recent.entries()) {
      const number = messages.length - recent.length + index + 1;
      const label = message.role === "tool"
        ? `tool:${message.toolName ?? "?"}`
        : message.role;
      console.log(
        `  ${dim(`#${number}`)} ${bold(label.padEnd(14))} ${singleLine(message.content, 140)}`,
      );
    }
    console.log();
  }

  sessionList(sessions: readonly SessionSummary[], currentId: string): void {
    this.spinner.stop();
    if (sessions.length === 0) {
      this.info("No saved sessions.");
      return;
    }

    console.log();
    for (const session of sessions) {
      const current = session.id === currentId ? cyan(" ← current") : "";
      console.log(
        `  ${bold(session.id)} ${dim(`· ${session.status} · ${session.messageCount} messages · ${session.updatedAt}`)}${current}`,
      );
    }
    console.log();
  }

  toolList(tools: readonly ToolDefinition[]): void {
    this.spinner.stop();
    console.log();
    for (const tool of tools) {
      console.log(`  ${bold(cyan(tool.name))} ${dim(tool.description)}`);
    }
    console.log();
  }

  sandboxInfo(root: string, entries: readonly SandboxEntry[]): void {
    this.spinner.stop();
    console.log();
    console.log(`  ${dim("sandbox")} ${root}`);
    if (entries.length === 0) {
      console.log(dim("  (empty)"));
    } else {
      for (const entry of entries) {
        const suffix = entry.type === "directory" ? "/" : ` (${entry.sizeBytes ?? 0} bytes)`;
        console.log(`  ${entry.name}${suffix}`);
      }
    }
    console.log();
  }

  help(): void {
    this.spinner.stop();
    console.log();
    const commands: Array<[string, string]> = [
      ["/help", "Show this help"],
      ["/new", "Start a new, empty session"],
      ["/sessions", "List saved sessions"],
      ["/history", "Show the last 20 messages of this session"],
      ["/tools", "List available tools"],
      ["/sandbox", "Show the sandbox root and its contents"],
      ["/model", "Show the configured Ollama model"],
      ["/exit", "Quit the CLI (Ctrl+D also works)"],
    ];
    for (const [command, description] of commands) {
      console.log(`  ${bold(command.padEnd(12))} ${dim(description)}`);
    }
    console.log(
      dim(
        "\n  Anything else is sent to the agent as a task. Ctrl+C cancels a running turn.",
      ),
    );
    console.log();
  }

  info(message: string): void {
    this.spinner.stop();
    console.log(dim(`  ${message}`));
  }

  warn(message: string): void {
    this.spinner.stop();
    console.log(`  ${yellow("!")} ${message}`);
  }

  error(message: string): void {
    this.spinner.stop();
    console.log(`  ${red("✗")} ${message}`);
  }
}
