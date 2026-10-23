import pc from "picocolors";
import type { AgentProfile } from "../../domain/entities/agent-profile.js";
import type {
  SessionMessage,
  SessionUsage,
} from "../../domain/entities/agent-session.js";
import type { Skill } from "../../domain/entities/skill.js";
import type { SubAgentRun } from "../../domain/entities/sub-agent-run.js";
import type { SandboxEntry } from "../../domain/ports/sandbox.port.js";
import type { SessionSummary } from "../../domain/ports/session-store.port.js";
import type { ToolDefinition } from "../../domain/ports/tool.port.js";
import type {
  ApprovalMode,
  ApprovalRequest,
} from "../../domain/ports/approval.port.js";
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
  arcHome: string;
  profile: string;
}

export interface StatusInput {
  profile: AgentProfile;
  model: string;
  workspace: string;
  arcHome: string;
  sessionId: string;
  depth: number;
  messageCount: number;
  usage: SessionUsage;
  context: { systemChars: number; historyChars: number; messages: number };
  autoCapture: boolean;
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
    console.log(`  ${bold(cyan("ARC — Autonomous Regenerative Companion"))}`);
    console.log(dim(`  profile  ${input.profile}`));
    console.log(dim(`  model    ${input.model}`));
    console.log(dim(`  workspace ${input.sandbox}`));
    console.log(dim(`  arc home ${input.arcHome}`));
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
    const suffix =
      outcome.observation.split(/\r?\n/).filter(Boolean).length > 2 ? " …" : "";
    const marker = outcome.ok ? green("✓") : red("✗");
    console.log(`  ${marker} ${dim(preview)}${dim(suffix)}`);
  }

  approvalRequest(request: ApprovalRequest): void {
    this.spinner.stop();
    console.log();
    console.log(
      `  ${yellow("approval")} ${bold(request.toolName)} ${dim(`· ${request.risk} · ${request.channel} · ${request.mode}`)}`,
    );
    console.log(`  ${dim("target")} ${describeApprovalTarget(request.args)}`);
    console.log(`  ${dim("reason")} ${singleLine(request.reason, 220)}`);
    if (request.risk === "shell") {
      console.log(
        dim(
          "  warning  Runs with your user privileges and can access files outside the workspace.",
        ),
      );
    }
    if (request.mode === "session") {
      console.log(
        dim(
          "  note     One network grant covers this tool for the current session.",
        ),
      );
    }
  }

  approvalQuestion(mode: ApprovalMode): string {
    return mode === "session"
      ? `  ${yellow("Approve?")} ${dim("[y] once · [s] this session · [n] no")} `
      : `  ${yellow("Approve?")} ${dim("[y] once · [n] no")} `;
  }

  subAgentStarted(input: {
    agentId: string;
    task: string;
    runId: string;
  }): void {
    this.spinner.stop();
    console.log(
      `  ${yellow("↳")} ${yellow(input.agentId)} ${dim(`started · ${singleLine(input.task, 100)}`)}`,
    );
    console.log(dim(`    ${input.runId}`));
  }

  subAgentFinished(input: {
    agentId: string;
    status: string;
    steps: number;
    summary: string;
  }): void {
    this.spinner.stop();
    const ok = input.status === "completed";
    const marker = ok ? green("✓") : red("✗");
    console.log(
      `  ${marker} ${yellow(input.agentId)} ${dim(`${input.status} · ${input.steps} tool call(s)`)}`,
    );
    if (input.summary) {
      console.log(dim(`    ${singleLine(input.summary, 140)}`));
    }
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
      const label =
        message.role === "tool"
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
      const child = session.parentId ? dim(" ↳ child") : "";
      console.log(
        `  ${bold(session.id)} ${dim(`· ${session.agentId} · ${session.status} · ${session.messageCount} messages · ${session.updatedAt}`)}${child}${current}`,
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
    console.log(`  ${dim("workspace")} ${root}`);
    if (entries.length === 0) {
      console.log(dim("  (empty)"));
    } else {
      for (const entry of entries) {
        const suffix =
          entry.type === "directory" ? "/" : ` (${entry.sizeBytes ?? 0} bytes)`;
        console.log(`  ${entry.name}${suffix}`);
      }
    }
    console.log();
  }

  status(input: StatusInput): void {
    this.spinner.stop();
    const estimatedTokens = Math.ceil(
      (input.context.systemChars + input.context.historyChars) / 4,
    );
    console.log();
    console.log(`  ${bold("status")}`);
    this.field("profile", `${input.profile.id} · ${input.profile.description}`);
    this.field("model", input.model);
    this.field("workspace", input.workspace);
    this.field("arc home", input.arcHome);
    this.field(
      "session",
      `${input.sessionId}${input.depth > 0 ? ` · depth ${input.depth}` : ""} · ${input.messageCount} messages`,
    );
    this.field(
      "usage",
      `${input.usage.modelCalls} model call(s) · ${input.usage.promptTokens} prompt tok · ${input.usage.completionTokens} completion tok`,
    );
    this.field(
      "context",
      `~${estimatedTokens} tokens estimated · ${input.context.messages} messages · ${input.context.systemChars} system chars`,
    );
    this.field("memory", input.autoCapture ? "auto-capture on" : "auto-capture off");
    this.field(
      "tools",
      input.profile.tools === "*" ? "all" : input.profile.tools.join(", "),
    );
    console.log();
  }

  memory(input: { user: string; longTerm: string; recentDaily: string }): void {
    this.spinner.stop();
    console.log();
    this.block("USER.md", input.user);
    this.block("MEMORY.md", input.longTerm);
    this.block("recent daily notes", input.recentDaily);
    console.log();
  }

  memoryResults(results: readonly { path: string; title: string; snippet: string; score: number }[]): void {
    this.spinner.stop();
    if (results.length === 0) {
      this.info("No memory matches.");
      return;
    }
    console.log();
    for (const result of results) {
      console.log(
        `  ${bold(cyan(result.path))} ${dim(`· ${result.title} · score ${result.score}`)}`,
      );
      console.log(dim(`    ${singleLine(result.snippet, 150)}`));
    }
    console.log();
  }

  skills(skills: readonly Skill[]): void {
    this.spinner.stop();
    if (skills.length === 0) {
      this.info("No skills installed.");
      return;
    }
    console.log();
    for (const skill of skills) {
      console.log(
        `  ${bold(cyan(skill.name))} ${dim(skill.description)}`,
      );
      if (skill.whenToUse) {
        console.log(dim(`    when: ${skill.whenToUse}`));
      }
    }
    console.log();
  }

  skill(skill: Skill): void {
    this.spinner.stop();
    console.log();
    console.log(`  ${bold(cyan(skill.name))} ${dim(skill.description)}`);
    if (skill.whenToUse) {
      console.log(dim(`  when: ${skill.whenToUse}`));
    }
    console.log(dim(`  source: ${skill.sourcePath}`));
    console.log();
    for (const line of skill.body.split(/\r?\n/)) {
      console.log(line.length > 0 ? `  ${line}` : "");
    }
    console.log();
  }

  profiles(profiles: readonly AgentProfile[], current: string): void {
    this.spinner.stop();
    console.log();
    for (const profile of profiles) {
      const marker = profile.id === current ? cyan(" ← current") : "";
      const source = profile.builtIn ? "" : dim(" · user");
      console.log(
        `  ${bold(cyan(profile.id))} ${dim(profile.description)}${source}${marker}`,
      );
      console.log(
        dim(
          `    tools: ${profile.tools === "*" ? "all" : profile.tools.join(", ")} · steps: ${profile.maxSteps} · spawn: ${profile.canSpawn ? "yes" : "no"}`,
        ),
      );
    }
    console.log();
  }

  tasks(runs: readonly SubAgentRun[]): void {
    this.spinner.stop();
    if (runs.length === 0) {
      this.info("No sub-agent runs for this session.");
      return;
    }
    console.log();
    for (const run of runs) {
      const marker =
        run.status === "completed"
          ? green("✓")
          : run.status === "running"
            ? yellow("…")
            : red("✗");
      console.log(
        `  ${marker} ${bold(run.id)} ${dim(`· ${run.agentId} · ${run.status} · ${run.steps} steps · ${run.createdAt}`)}`,
      );
      console.log(dim(`    ${singleLine(run.task, 140)}`));
    }
    console.log();
  }

  task(run: SubAgentRun): void {
    this.spinner.stop();
    console.log();
    console.log(`  ${bold("task")} ${run.id}`);
    this.field("agent", `${run.agentId} · depth ${run.depth}`);
    this.field("status", run.status);
    this.field("child session", run.childSessionId);
    this.field("created", run.createdAt);
    if (run.finishedAt) {
      this.field("finished", run.finishedAt);
    }
    this.field("usage", `${run.usage.modelCalls} model call(s)`);
    console.log(`\n  ${dim("task")}\n  ${run.task}`);
    if (run.error) {
      console.log(`\n  ${red("error")}\n  ${run.error}`);
    }
    this.block("summary", run.summary);
    console.log();
  }

  help(): void {
    this.spinner.stop();
    console.log();
    const commands: Array<[string, string]> = [
      ["/help", "Show this help"],
      ["/new [profile]", "Start a new session, optionally with an agent profile"],
      ["/sessions", "List saved sessions"],
      ["/history [id]", "Show recent messages (current session or a child id)"],
      ["/status", "Profile, paths, usage, and context estimate"],
      ["/tools", "List tools available to the current profile"],
      ["/memory", "Show USER.md, MEMORY.md, and recent daily notes"],
      ["/search <query>", "Search Markdown memory"],
      ["/remember [daily] <text>", "Save a durable memory note"],
      ["/skills", "List installed skills"],
      ["/skill <name>", "Show a skill body"],
      ["/skill reload", "Re-scan skill directories"],
      ["/agents", "List agent profiles"],
      ["/agent <name> <task>", "Run a sub-agent directly"],
      ["/tasks", "List sub-agent runs for this session"],
      ["/task <id>", "Show one sub-agent run"],
      ["/compact", "Summarize older history now"],
      ["/cancel", "Cancel the running turn (Ctrl+C also works)"],
      ["/sandbox [path]", "Show the workspace and a directory listing"],
      ["/model", "Show the configured Ollama model"],
      ["/exit", "Quit the CLI (Ctrl+D also works)"],
    ];
    for (const [command, description] of commands) {
      console.log(`  ${bold(command.padEnd(24))} ${dim(description)}`);
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

  private field(label: string, value: string): void {
    console.log(`  ${dim(label.padEnd(12))} ${value}`);
  }

  private block(title: string, text: string): void {
    console.log(`  ${bold(title)}`);
    const trimmed = text.trim();
    if (!trimmed) {
      console.log(dim("  (empty)"));
      return;
    }
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines.slice(0, 40)) {
      console.log(`  ${line}`);
    }
    if (lines.length > 40) {
      console.log(dim(`  … ${lines.length - 40} more line(s)`));
    }
    console.log();
  }
}

function describeApprovalTarget(args: unknown): string {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (typeof record.command === "string") {
      return singleLine(record.command, 700);
    }
    if (typeof record.url === "string") {
      return singleLine(record.url, 700);
    }
    if (typeof record.query === "string") {
      const count =
        typeof record.count === "number" ? ` · count ${record.count}` : "";
      return singleLine(`"${record.query}"${count}`, 600);
    }
    if (
      typeof record.path === "string" &&
      typeof record.old_string === "string"
    ) {
      return `${record.path} · replace ${record.old_string.length} char(s)`;
    }
  }
  return singleLine(JSON.stringify(args ?? null), 600);
}
