import { createInterface, type Interface } from "node:readline";
import pc from "picocolors";
import type { AgentProfile } from "../../domain/entities/agent-profile.js";
import { AgentSession } from "../../domain/entities/agent-session.js";
import type { EventBusPort } from "../../domain/events/agent-event.js";
import type { MemoryStorePort } from "../../domain/ports/memory-store.port.js";
import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { SessionStorePort } from "../../domain/ports/session-store.port.js";
import type { SkillRepositoryPort } from "../../domain/ports/skill-repository.port.js";
import type { SubAgentRepositoryPort } from "../../domain/ports/sub-agent-repository.port.js";
import type { SubAgentRunnerPort } from "../../domain/ports/sub-agent-runner.port.js";
import { createSessionId } from "../../shared/id.js";
import { errorMessage, truncateText } from "../../shared/text.js";
import type { ContextAssembler } from "../../application/services/context-assembler.js";
import type { ToolRegistry } from "../../application/services/tool-registry.js";
import type { CompactSessionUseCase } from "../../application/usecases/compact-session.usecase.js";
import type { RunAgentTurnUseCase } from "../../application/usecases/run-agent-turn.usecase.js";
import type { TerminalRenderer } from "./terminal.renderer.js";

export interface ChatReplDeps {
  sessionStore: SessionStorePort;
  sandbox: SandboxPort;
  registry: ToolRegistry;
  runAgentTurn: RunAgentTurnUseCase;
  renderer: TerminalRenderer;
  modelName: string;
  agentHome: string;
  defaultProfileId: string;
  profiles: AgentProfileRepositoryPort;
  skills: SkillRepositoryPort;
  memory: MemoryStorePort;
  compacter: CompactSessionUseCase;
  subAgentRuns: SubAgentRepositoryPort;
  subAgentRunner: SubAgentRunnerPort;
  assembler: ContextAssembler;
  events: EventBusPort;
  memoryAutoCapture: boolean;
}

export class ChatRepl {
  private session: AgentSession | null = null;
  private rl: Interface | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private turnLineHandler: ((line: string) => void) | null = null;
  private closed = false;

  constructor(private readonly deps: ChatReplDeps) {
    this.deps.events.on("subagent.started", (event) => {
      this.deps.renderer.subAgentStarted({
        agentId: String(event.data.agentId ?? "agent"),
        task: String(event.data.task ?? ""),
        runId: String(event.data.runId ?? ""),
      });
    });
    this.deps.events.on("subagent.finished", (event) => {
      this.deps.renderer.subAgentFinished({
        agentId: String(event.data.agentId ?? "agent"),
        status: String(event.data.status ?? "unknown"),
        steps: Number(event.data.steps ?? 0),
        summary: String(event.data.summary ?? ""),
      });
    });
  }

  async start(): Promise<void> {
    const resumed = await this.deps.sessionStore.latest();
    this.session =
      resumed ??
      AgentSession.create(createSessionId(), {
        agentId: this.deps.defaultProfileId,
      });

    if (!resumed) {
      await this.persist();
    }

    this.deps.renderer.banner({
      model: this.deps.modelName,
      sandbox: this.deps.sandbox.root,
      sessionId: this.session.id,
      resumed: Boolean(resumed),
      agentHome: this.deps.agentHome,
      profile: this.session.agentId,
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

    // Fallback for terminals where readline is not intercepting Ctrl+C.
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
      this.detachTurnInput();
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
    const match = input.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const command = (match?.[1] ?? "").toLowerCase();
    const argument = (match?.[2] ?? "").trim();
    const session = this.activeSession();

    switch (command) {
      case "/help":
        this.deps.renderer.help();
        return false;

      case "/new": {
        const requested = argument || this.deps.defaultProfileId;
        const profile = await this.deps.profiles.get(requested);
        if (!profile) {
          this.deps.renderer.error(
            `Unknown profile "${requested}". Use /agents to see profiles.`,
          );
          return false;
        }
        await this.persist();
        this.session = AgentSession.create(createSessionId(), {
          agentId: profile.id,
        });
        await this.persist();
        this.deps.renderer.info(
          `Started new ${profile.id} session ${this.session.id}.`,
        );
        return false;
      }

      case "/sessions":
        this.deps.renderer.sessionList(
          await this.deps.sessionStore.list(),
          session.id,
        );
        return false;

      case "/history": {
        if (argument) {
          const other = await this.deps.sessionStore.load(argument);
          if (!other) {
            this.deps.renderer.error(`Session "${argument}" was not found.`);
            return false;
          }
          this.deps.renderer.info(`Session ${other.id} (${other.agentId}):`);
          this.deps.renderer.history(other.messages);
        } else {
          this.deps.renderer.history(session.messages);
        }
        return false;
      }

      case "/status": {
        const profile = await this.profileFor(session);
        try {
          const context = await this.deps.assembler.estimate(session, profile);
          this.deps.renderer.status({
            profile,
            model: this.deps.modelName,
            workspace: this.deps.sandbox.root,
            agentHome: this.deps.agentHome,
            sessionId: session.id,
            depth: session.depth,
            messageCount: session.messages.length,
            usage: session.usage,
            context,
            autoCapture: this.deps.memoryAutoCapture,
          });
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;
      }

      case "/tools": {
        const profile = await this.profileFor(session);
        this.deps.renderer.toolList(
          this.deps.registry
            .getDefinitions()
            .filter((tool) => profile.allowsTool(tool.name)),
        );
        return false;
      }

      case "/sandbox":
        try {
          this.deps.renderer.sandboxInfo(
            this.deps.sandbox.root,
            await this.deps.sandbox.list(argument || "."),
          );
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;

      case "/memory":
        try {
          this.deps.renderer.memory(await this.deps.memory.readCore());
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;

      case "/search":
        if (!argument) {
          this.deps.renderer.warn("Usage: /search <query>");
          return false;
        }
        try {
          this.deps.renderer.memoryResults(
            await this.deps.memory.search(argument, 8),
          );
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;

      case "/remember": {
        if (!argument) {
          this.deps.renderer.warn("Usage: /remember [daily] <text>");
          return false;
        }
        const daily = argument.startsWith("daily ");
        const content = daily ? argument.slice("daily ".length).trim() : argument;
        if (!content) {
          this.deps.renderer.warn("Usage: /remember [daily] <text>");
          return false;
        }
        try {
          const result = await this.deps.memory.remember(
            content,
            daily ? "daily" : "long-term",
          );
          this.deps.events.emit("memory.written", {
            sessionId: session.id,
            agentId: session.agentId,
            data: { path: result.path, scope: daily ? "daily" : "long-term" },
          });
          this.deps.renderer.info(`Remembered in ${result.path}.`);
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;
      }

      case "/skills":
        this.deps.renderer.skills(await this.deps.skills.list());
        return false;

      case "/skill": {
        if (argument === "reload") {
          await this.deps.skills.reload();
          this.deps.renderer.info(
            `Reloaded ${(await this.deps.skills.list()).length} skill(s).`,
          );
          return false;
        }
        const name = argument.replace(/^show\s+/, "").trim();
        if (!name) {
          this.deps.renderer.skills(await this.deps.skills.list());
          return false;
        }
        const skill = await this.deps.skills.get(name);
        if (!skill) {
          this.deps.renderer.error(`Unknown skill "${name}".`);
          return false;
        }
        this.deps.renderer.skill(skill);
        return false;
      }

      case "/agents":
        this.deps.renderer.profiles(
          await this.deps.profiles.list(),
          session.agentId,
        );
        return false;

      case "/agent":
        await this.runAgentDirect(argument);
        return false;

      case "/tasks": {
        try {
          const runs = await this.deps.subAgentRuns.listByParent(session.id, 20);
          this.deps.renderer.tasks(runs);
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;
      }

      case "/task": {
        if (!argument) {
          this.deps.renderer.warn("Usage: /task <run-id>");
          return false;
        }
        try {
          const run = await this.deps.subAgentRuns.load(argument);
          if (!run) {
            this.deps.renderer.error(`Task "${argument}" was not found.`);
            return false;
          }
          this.deps.renderer.task(run);
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;
      }

      case "/compact": {
        try {
          const result = await this.deps.compacter.force(session);
          this.deps.renderer.info(
            result.compacted
              ? `Compacted ${result.messagesSummarized} message(s) into the session summary.`
              : "Nothing to compact yet (keep-recent window is too large).",
          );
          await this.persist();
        } catch (error) {
          this.deps.renderer.error(errorMessage(error));
        }
        return false;
      }

      case "/cancel":
        if (this.running) {
          this.abortController?.abort();
        } else {
          this.deps.renderer.info("No turn is running.");
        }
        return false;

      case "/model":
        this.deps.renderer.info(
          `Model: ${this.deps.modelName} (configure OLLAMA_MODEL in .env)`,
        );
        if (argument) {
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
    const profile = await this.profileFor(session);
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.attachTurnInput();

    try {
      const answer = await this.deps.runAgentTurn.execute({
        session,
        profile,
        prompt,
        signal,
        callbacks: {
          onThinkingStart: () => this.deps.renderer.startThinking(),
          onThinkingEnd: () => this.deps.renderer.stopThinking(),
          onThought: (thought) => this.deps.renderer.thought(thought),
          onToolCall: (call) => this.deps.renderer.toolCall(call),
          onToolResult: (call, outcome) =>
            this.deps.renderer.toolResult(call, outcome),
          onFinal: (message) => this.deps.renderer.finalAnswer(message),
        },
      });

      if (this.deps.memoryAutoCapture) {
        try {
          const result = await this.deps.memory.appendDaily(
            `User: ${truncateText(prompt, 500)}\nAssistant: ${truncateText(answer, 700)}`,
          );
          this.deps.events.emit("memory.written", {
            sessionId: session.id,
            agentId: session.agentId,
            data: { path: result.path, scope: "daily" },
          });
        } catch (error) {
          this.deps.renderer.warn(
            `Could not auto-capture the turn: ${errorMessage(error)}`,
          );
        }
      }
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
      this.detachTurnInput();
      await this.persist();
    }
  }

  private async runAgentDirect(argument: string): Promise<void> {
    const match = argument.match(/^(\S+)\s+([\s\S]+)$/);
    if (!match) {
      this.deps.renderer.warn("Usage: /agent <profile> <task>");
      return;
    }
    const agentId = match[1] ?? "";
    const task = (match[2] ?? "").trim();
    const session = this.activeSession();
    const profile = await this.deps.profiles.get(agentId);
    if (!profile) {
      this.deps.renderer.error(`Unknown profile "${agentId}".`);
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    this.attachTurnInput();
    try {
      const result = await this.deps.subAgentRunner.run({
        parentSessionId: session.id,
        parentAgentId: session.agentId,
        parentDepth: session.depth,
        agentId,
        task,
        signal: this.abortController.signal,
      });
      this.deps.renderer.info(
        `Run ${result.runId} ${result.status}. Use /task ${result.runId} for details.`,
      );
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.deps.renderer.warn("Sub-agent cancelled.");
      } else {
        this.deps.renderer.error(errorMessage(error));
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.detachTurnInput();
    }
  }

  private attachTurnInput(): void {
    if (!this.rl || !process.stdin.isTTY || this.turnLineHandler) {
      return;
    }
    const handler = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed === "/cancel" || trimmed === "/stop") {
        this.deps.renderer.warn("Cancelling the current turn…");
        this.abortController?.abort();
        return;
      }
      this.deps.renderer.warn(
        "A turn is running. Type /cancel or press Ctrl+C to stop it.",
      );
    };
    this.turnLineHandler = handler;
    this.rl.on("line", handler);
  }

  private detachTurnInput(): void {
    if (this.rl && this.turnLineHandler) {
      this.rl.removeListener("line", this.turnLineHandler);
    }
    this.turnLineHandler = null;
  }

  private async profileFor(session: AgentSession): Promise<AgentProfile> {
    const profile =
      (await this.deps.profiles.get(session.agentId)) ??
      (await this.deps.profiles.get(this.deps.defaultProfileId));
    if (!profile) {
      throw new Error(
        `Agent profile "${session.agentId}" and fallback "${this.deps.defaultProfileId}" were not found.`,
      );
    }
    return profile;
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
