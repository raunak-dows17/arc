import { createInterface, type Interface } from "node:readline";
import pc from "picocolors";
import { AgentSession } from "../../domain/entities/agent-session.js";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { SessionStorePort } from "../../domain/ports/session-store.port.js";
import { createSessionId } from "../../shared/id.js";
import { errorMessage } from "../../shared/text.js";
import type { RunAgentTurnUseCase } from "../../application/usecases/run-agent-turn.usecase.js";
import type { ToolRegistry } from "../../application/services/tool-registry.js";
import type { TerminalRenderer } from "./terminal.renderer.js";

export interface ChatReplDeps {
  sessionStore: SessionStorePort;
  sandbox: SandboxPort;
  registry: ToolRegistry;
  runAgentTurn: RunAgentTurnUseCase;
  renderer: TerminalRenderer;
  modelName: string;
}

export class ChatRepl {
  private session: AgentSession | null = null;
  private rl: Interface | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private closed = false;

  constructor(private readonly deps: ChatReplDeps) {}

  async start(): Promise<void> {
    const resumed = await this.deps.sessionStore.latest();
    this.session = resumed ?? AgentSession.create(createSessionId());

    if (!resumed) {
      await this.persist();
    }

    this.deps.renderer.banner({
      model: this.deps.modelName,
      sandbox: this.deps.sandbox.root,
      sessionId: this.session.id,
      resumed: Boolean(resumed),
    });

    if (resumed) {
      this.deps.renderer.info(
        `Resumed ${resumed.messages.length} message(s). Type /new to start a fresh session.`,
      );
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
      historySize: 200,
      removeHistoryDuplicates: true,
    });
    this.rl = rl;

    let idleInterrupts = 0;
    rl.on("SIGINT", () => {
      if (this.running) {
        this.deps.renderer.warn("Cancelling the current turn…");
        this.abortController?.abort();
        return;
      }

      idleInterrupts += 1;
      if (idleInterrupts >= 2) {
        rl.close();
        return;
      }

      this.deps.renderer.info("Press Ctrl+C again to exit.");
      const reset = setTimeout(() => {
        idleInterrupts = 0;
      }, 2000);
      reset.unref();
    });

    // Fallback for terminals where readline is not intercepting Ctrl+C
    // (for example while no prompt is active during a long agent turn).
    const onProcessSigint = (): void => {
      if (this.running) {
        this.deps.renderer.warn("Cancelling the current turn…");
        this.abortController?.abort();
        return;
      }
      rl.close();
    };
    process.on("SIGINT", onProcessSigint);

    rl.on("close", () => {
      this.closed = true;
    });

    try {
      if (process.stdin.isTTY) {
        while (!this.closed) {
          const input = await this.ask(rl);
          if (input === null) {
            break;
          }
          if (await this.processInput(input)) {
            break;
          }
        }
      } else {
        // Piped input must be consumed as a stream; readline.question would
        // otherwise drop buffered lines that arrive before the next question.
        for await (const line of rl) {
          if (await this.processInput(line)) {
            break;
          }
        }
      }
    } finally {
      process.off("SIGINT", onProcessSigint);
      this.deps.renderer.stopThinking();
      rl.close();
      this.deps.renderer.info("Goodbye.");
    }
  }

  private async processInput(input: string): Promise<boolean> {
    const trimmed = input.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.startsWith("/")) {
      return this.handleCommand(trimmed);
    }

    await this.runTurn(trimmed);
    return false;
  }

  private ask(rl: Interface): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const onClose = (): void => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };

      rl.once("close", onClose);
      rl.question(`${pc.cyan("›")} `, (answer) => {
        if (settled) {
          return;
        }
        settled = true;
        rl.removeListener("close", onClose);
        resolve(answer);
      });
    });
  }

  private async handleCommand(input: string): Promise<boolean> {
    const [command = "", ...rest] = input.trim().split(/\s+/);
    const session = this.activeSession();

    switch (command.toLowerCase()) {
      case "/help":
        this.deps.renderer.help();
        return false;

      case "/new":
        await this.persist();
        this.session = AgentSession.create(createSessionId());
        await this.persist();
        this.deps.renderer.info(`Started new session ${this.session.id}.`);
        return false;

      case "/sessions":
        this.deps.renderer.sessionList(
          await this.deps.sessionStore.list(),
          session.id,
        );
        return false;

      case "/history":
        this.deps.renderer.history(session.messages);
        return false;

      case "/tools":
        this.deps.renderer.toolList(this.deps.registry.getDefinitions());
        return false;

      case "/sandbox":
        try {
          this.deps.renderer.sandboxInfo(
            this.deps.sandbox.root,
            await this.deps.sandbox.list("."),
          );
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;

      case "/model":
        this.deps.renderer.info(
          `Model: ${this.deps.modelName} (configure OLLAMA_MODEL in .env)`,
        );
        if (rest.length > 0) {
          this.deps.renderer.warn(
            "Changing models mid-session is not supported. Edit .env and restart.",
          );
        }
        return false;

      case "/exit":
      case "/quit":
        return true;

      default:
        this.deps.renderer.warn(
          `Unknown command "${command}". Type /help for available commands.`,
        );
        return false;
    }
  }

  private async runTurn(prompt: string): Promise<void> {
    const session = this.activeSession();
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      await this.deps.runAgentTurn.execute({
        session,
        prompt,
        signal,
        callbacks: {
          onThinkingStart: () => this.deps.renderer.startThinking(),
          onThinkingEnd: () => this.deps.renderer.stopThinking(),
          onThought: (thought) => this.deps.renderer.thought(thought),
          onToolCall: (call) => this.deps.renderer.toolCall(call),
          onToolResult: (call, outcome) =>
            this.deps.renderer.toolResult(call, outcome),
          onFinal: (answer) => this.deps.renderer.finalAnswer(answer),
        },
      });
    } catch (error) {
      this.deps.renderer.stopThinking();
      if (signal.aborted) {
        this.deps.renderer.warn("Turn cancelled.");
      } else {
        this.deps.renderer.error(errorMessage(error));
      }
    } finally {
      this.running = false;
      this.abortController = null;
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) {
      return;
    }
    try {
      await this.deps.sessionStore.save(this.session);
    } catch (error) {
      this.deps.renderer.error(errorMessage(error));
    }
  }

  private activeSession(): AgentSession {
    if (!this.session) {
      throw new Error("Session has not been initialised.");
    }
    return this.session;
  }
}
