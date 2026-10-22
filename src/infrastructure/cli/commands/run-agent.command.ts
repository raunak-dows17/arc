import * as readline from "readline/promises";
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

    const rl = readline.createInterface({ input, output });

    while (true) {
      const userObjective = await rl.question(
        pc.bold(pc.cyan("✨ What would you like me to do? > ")),
      );
      const trimmedObjective = userObjective.trim();

      if (!trimmedObjective) {
        continue;
      }

      if (["exit", "quit", "q"].includes(trimmedObjective.toLowerCase())) {
        console.log(
          pc.green("\n👋 Goodbye! Shutting down autonomous agent cleanly.\n"),
        );
        rl.close();
        break;
      }

      if (trimmedObjective.toLowerCase() === "clear") {
        this.renderer.renderWelcomeBanner();
        continue;
      }

      await this.executeSingleObjective(trimmedObjective);
    }
  }

  /**
   * Executes a single objective passed either via CLI arguments or interactive prompt.
   */
  public async executeSingleObjective(objective: string): Promise<void> {
    const agentId = crypto.randomUUID();
    this.renderer.renderObjectiveStart(objective, agentId);

    try {
      await this.executeAgentUseCase.execute(
        { agentId, objective },
        {
          onStepUpdate: (message, type) => {
            this.renderer.renderStep(message, type);
          },
        },
      );
    } catch (error: unknown) {
      this.renderer.renderError(
        error instanceof Error
          ? error.message
          : "Unknown execution error occurred.",
      );
    }
  }
}
