import pc from "picocolors";
import { env } from "../../../shared/config/env.js";

type StepType =
  | "thought"
  | "action"
  | "observation"
  | "reflection"
  | "answer";

type Color = (value: string) => string;

const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export const ARC_LOGO_LINES = [
  "   /\\     _____     _____",
  "  /  \\   |  __ \\   / ____|",
  " / /\\ \\  | |__) | | |",
  "/ ____ \\ |  _  /  | |",
  "/_/  \\_\\ | | \\ \\  | |____",
  "         |_|  \\_\\  \\_____/",
  "",
  "       A R C  |  AUTONOMOUS REASONING CORE",
];

export interface TerminalRendererOptions {
  mode?: "development" | "production" | "test";
  width?: number;
  interactive?: boolean;
}

export class TerminalRenderer {
  private activityTimer: NodeJS.Timeout | undefined;
  private activityFrame = 0;
  private activityMessage = "Working";
  private readonly spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

  constructor(
    private readonly options: TerminalRendererOptions = {},
  ) {}

  public renderWelcomeBanner(): void {
    this.stopActivity();
    if (this.isInteractive()) {
      console.clear();
    }

    const width = this.panelWidth();
    const innerWidth = width - 2;
    console.log(pc.cyan(`╭${"━".repeat(innerWidth)}╮`));
    for (const line of ARC_LOGO_LINES) {
      this.writePanelLine(pc.bold(pc.cyan(line)), width, pc.cyan);
    }
    this.writePanelLine(
      pc.bold(pc.cyan("PLAN  >  ACT  >  VERIFY  >  RECOVER")),
      width,
      pc.cyan,
    );
    console.log(pc.cyan(`┣${"━".repeat(innerWidth)}┫`));
    this.writePanelLine(
      pc.dim("A focused workspace for turning objectives into outcomes."),
      width,
      pc.cyan,
    );
    if (this.mode() === "development") {
      this.writePanelLine(
        `${pc.dim("PROVIDER")}  ${pc.green(
          pc.bold(env.AI_PROVIDER.toUpperCase()),
        )}     ${pc.dim("MODEL")}  ${pc.yellow(env.OLLAMA_MODEL)}`,
        width,
        pc.cyan,
      );
      this.writePanelLine(
        `${pc.dim("ITERATIONS")} ${pc.magenta(
          String(env.MAX_AGENT_ITERATIONS),
        )}     ${pc.dim("WORKSPACE")}  ${pc.blue("./agent_sandbox")}`,
        width,
        pc.cyan,
      );
    } else {
      this.writePanelLine(
        `${pc.dim("MODE")}  ${pc.green(pc.bold(this.mode().toUpperCase()))}     ${pc.dim("WORKSPACE")}  ${pc.blue("./agent_sandbox")}`,
        width,
        pc.cyan,
      );
    }
    console.log(pc.cyan(`╰${"━".repeat(width - 2)}╯`));
    console.log();
    this.renderHelp();
  }

  public renderHelp(): void {
    this.renderBox(
      "QUICK GUIDE",
      [
        "Describe one clear objective and press Enter.",
        'Commands: "help" for this guide  •  "clear" for a fresh screen  •  "exit" to quit.',
        "The agent works in ./agent_sandbox.",
        ...(this.mode() === "development"
          ? ["Development mode shows model and iteration details."]
          : []),
      ].join("\n"),
      pc.dim,
    );
  }

  public renderInputBox(): string {
    const width = this.panelWidth();
    const innerWidth = width - 2;
    const hint = "Type your request, then press Enter";
    console.log();
    console.log(pc.cyan(`╭${"─".repeat(innerWidth)}╮`));
    this.writePanelLine(
      pc.bold(pc.white("YOUR OBJECTIVE")),
      width,
      pc.cyan,
    );
    console.log(
      `${pc.cyan("│")} ${pc.bold(pc.cyan("›"))} ${pc.dim(hint)}${" ".repeat(
        Math.max(0, innerWidth - 3 - this.visibleLength(hint)),
      )}${pc.cyan("│")}`,
    );
    return `${this.readlineSafe(pc.cyan("│"))} ${this.readlineSafe(
      pc.bold(pc.green(">")),
    )} `;
  }

  public finishInputBox(): void {
    const width = this.panelWidth();
    const innerWidth = width - 2;
    console.log(pc.cyan(`╰${"─".repeat(innerWidth)}╯`));
  }

  public renderQueuedInput(objective: string): void {
    const prompt = this.renderInputBox().replace(/[\u0001\u0002]/g, "");
    outputWrite(`${prompt}${objective}\n`);
    this.finishInputBox();
  }

  public renderBusyInputNotice(): void {
    this.renderBox(
      "AGENT IS WORKING",
      "That input was not queued. Wait for the current result, then enter a new objective.",
      pc.yellow,
    );
  }

  public renderObjectiveStart(objective: string, agentId: string): void {
    this.renderBox(
      "NEW OBJECTIVE",
      `${objective}\n${pc.dim(`Session ${agentId}`)}`,
      pc.cyan,
    );
  }

  public startActivity(message = this.activityMessage): void {
    this.stopActivity();
    this.activityMessage = message;
    this.activityFrame = 0;
    this.activityTimer = setInterval(() => {
      const frame =
        this.spinnerFrames[this.activityFrame % this.spinnerFrames.length];
      this.activityFrame += 1;
      outputWrite(`\r${pc.cyan(frame)} ${pc.dim(message)}…`);
    }, 100);
    this.activityTimer.unref();
    outputWrite(`${pc.cyan(this.spinnerFrames[0])} ${pc.dim(message)}…`);
  }

  public stopActivity(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = undefined;
      outputWrite("\r\u001B[2K");
    }
  }

  public renderStep(message: string, type: StepType): void {
    this.stopActivity();
    const panels: Record<
      StepType,
      { title: string; color: Color }
    > = {
      thought: { title: "[~] THINKING", color: pc.yellow },
      action: { title: "[>] ACTION", color: pc.blue },
      observation: { title: "[✓] RESULT", color: pc.magenta },
      reflection: { title: "[?] CHECK", color: pc.cyan },
      answer: { title: "[★] FINAL ANSWER", color: pc.green },
    };
    const panel = panels[type];
    this.renderBox(panel.title, message, panel.color);
  }

  public renderError(errorMsg: string): void {
    this.stopActivity();
    this.renderBox("ERROR", errorMsg, pc.red);
  }

  private renderBox(title: string, message: string, color: Color): void {
    const width = this.panelWidth();
    const innerWidth = width - 2;
    console.log();
    console.log(color(`╭${"─".repeat(innerWidth)}╮`));
    this.writePanelLine(pc.bold(color(` ${title}`)), width, color);
    console.log(color(`├${"─".repeat(innerWidth)}┤`));

    const plainText = message.replace(ANSI_ESCAPE, "");
    for (const paragraph of plainText.split("\n")) {
      if (paragraph.length === 0) {
        this.writePanelLine("", width, color);
        continue;
      }
      for (const line of this.wrap(paragraph, innerWidth - 2)) {
        this.writePanelLine(line, width, color);
      }
    }
    console.log(color(`╰${"─".repeat(innerWidth)}╯`));
    if (this.activityTimer) {
      this.startActivity(this.activityMessage);
    }
  }

  private writePanelLine(
    content: string,
    width: number,
    borderColor: Color,
  ): void {
    const innerWidth = width - 2;
    const availableWidth = Math.max(1, innerWidth - 2);
    const plainContent = content.replace(ANSI_ESCAPE, "");
    const contentLines =
      this.visibleLength(plainContent) > availableWidth
        ? this.wrap(plainContent, availableWidth).map((line) =>
            borderColor(line),
          )
        : [content];

    for (const line of contentLines) {
      const padding = Math.max(
        0,
        availableWidth - this.visibleLength(line),
      );
      console.log(
        `${borderColor("│")} ${line}${" ".repeat(padding)} ${borderColor("│")}`,
      );
    }
  }

  private wrap(value: string, maxWidth: number): string[] {
    const words = value.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      if (!word) {
        continue;
      }
      if (this.visibleLength(word) > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        let remainder = word;
        while (this.visibleLength(remainder) > maxWidth) {
          const part = Array.from(remainder).slice(0, maxWidth).join("");
          lines.push(part);
          remainder = Array.from(remainder).slice(maxWidth).join("");
        }
        currentLine = remainder;
      } else if (
        !currentLine ||
        this.visibleLength(`${currentLine} ${word}`) <= maxWidth
      ) {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [""];
  }

  private visibleLength(value: string): number {
    return Array.from(value.replace(ANSI_ESCAPE, "")).length;
  }

  private readlineSafe(value: string): string {
    return this.isInteractive() ? `\u0001${value}\u0002` : value;
  }

  private panelWidth(): number {
    const columns = this.options.width ?? process.stdout.columns ?? 80;
    return Math.max(24, Math.min(96, columns - 2));
  }

  private mode(): "development" | "production" | "test" {
    return this.options.mode ?? env.NODE_ENV;
  }

  private isInteractive(): boolean {
    return this.options.interactive ?? Boolean(process.stdout.isTTY);
  }
}

function outputWrite(value: string): void {
  process.stdout.write(value);
}
