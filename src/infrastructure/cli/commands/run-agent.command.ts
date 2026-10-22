import * as readline from "node:readline";
import { stdin as input, stdout as output } from "process";
import * as crypto from "crypto";
import pc from "picocolors";
import type { ExecuteAgentLoopUseCase } from "../../../application/usecases/execute_agent_loop.usecase.js";
import type { TerminalRenderer } from "../ui/terminal.renderer.js";

export class RunAgentCommand {
  constructor(
    private readonly executeAgentUseCase: ExecuteAgentLoopUseCase,
    private readonly renderer: TerminalRenderer,
  ) {}

  /**
   * Starts an interactive, welcoming REPL session in the terminal.
   */
  public async startInteractiveSession(): Promise<void> {
    this.renderer.renderWelcomeBanner();

    const rl = readline.createInterface({
      input,
      output,
      crlfDelay: Infinity,
    });
    let busy = false;
    let closed = false;
    let resolveNextLine: ((line: string) => void) | undefined;
    const queuedLines: string[] = [];

    rl.on("close", () => {
      closed = true;
      const resolve = resolveNextLine;
      resolveNextLine = undefined;
      resolve?.("");
    });
    rl.on("SIGINT", () => {
      console.log(pc.dim("\n\nClosing the interactive session…"));
      rl.close();
    });
    rl.on("line", (line) => {
      if (busy) {
        this.renderer.renderBusyInputNotice();
        return;
      }
      const resolve = resolveNextLine;
      if (resolve) {
        resolveNextLine = undefined;
        resolve(line);
      } else {
        queuedLines.push(line);
      }
    });

    try {
      while (!closed) {
        let userObjective: string;
        const queuedLine = queuedLines.shift();
        if (queuedLine !== undefined) {
          userObjective = queuedLine;
          this.renderer.renderQueuedInput(userObjective);
        } else {
          rl.setPrompt(this.renderer.renderInputBox());
          rl.prompt();
          userObjective = await new Promise<string>((resolve) => {
                resolveNextLine = resolve;
              });
        }
        if (closed) {
          break;
        }
        if (queuedLine === undefined) {
          this.renderer.finishInputBox();
        }
        const trimmedObjective = userObjective.trim();

        if (!trimmedObjective) {
          continue;
        }

        if (["exit", "quit", "q"].includes(trimmedObjective.toLowerCase())) {
          console.log(pc.green("\n👋 Goodbye! Shutting down cleanly.\n"));
          break;
        }

        if (trimmedObjective.toLowerCase() === "help") {
          this.renderer.renderHelp();
          continue;
        }

        if (trimmedObjective.toLowerCase() === "clear") {
          this.renderer.renderWelcomeBanner();
          continue;
        }

        busy = true;
        try {
          await this.executeSingleObjective(trimmedObjective);
        } finally {
          busy = false;
          this.renderer.stopActivity();
        }
      }
    } finally {
      rl.close();
    }
  }

  /**
   * Executes a single objective passed either via CLI arguments or interactive prompt.
   */
  public async executeSingleObjective(objective: string): Promise<void> {
    const agentId = crypto.randomUUID();
    this.renderer.renderObjectiveStart(objective, agentId);

    try {
      this.renderer.startActivity("Starting agent");
      await this.executeAgentUseCase.execute(
        { agentId, objective },
        {
          onStepUpdate: (message, type) => {
            this.renderer.renderStep(message, type);
            if (type !== "answer") {
              this.renderer.startActivity("Waiting for agent");
            }
          },
        },
      );
    } catch (error: unknown) {
      this.renderer.renderError(
        error instanceof Error
          ? error.message
          : "Unknown execution error occurred.",
      );
    } finally {
      this.renderer.stopActivity();
    }
  }
}
