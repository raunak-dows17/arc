import path from "node:path";
import { ExecuteToolUseCase } from "./application/usecases/execute-tool.usecase.js";
import { RunAgentTurnUseCase } from "./application/usecases/run-agent-turn.usecase.js";
import { buildSystemPrompt } from "./application/services/system-prompt.js";
import { ToolRegistry } from "./application/services/tool-registry.js";
import { ChatRepl } from "./infrastructure/cli/repl.js";
import { TerminalRenderer } from "./infrastructure/cli/terminal.renderer.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { OllamaLlmAdapter } from "./infrastructure/llm/ollama.adapter.js";
import { JsonSessionStore } from "./infrastructure/persistence/json-session.store.js";
import { NodeFsSandboxAdapter } from "./infrastructure/sandbox/node-fs-sandbox.adapter.js";
import { ListFilesTool } from "./infrastructure/tools/list-files.tool.js";
import { ReadFileTool } from "./infrastructure/tools/read-file.tool.js";
import { WriteFileTool } from "./infrastructure/tools/write-file.tool.js";
import { errorMessage } from "./shared/text.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const renderer = new TerminalRenderer();

  const sandbox = await NodeFsSandboxAdapter.create(config.sandboxDir);
  const registry = new ToolRegistry();
  registry.register(new ListFilesTool(sandbox));
  registry.register(new ReadFileTool(sandbox));
  registry.register(new WriteFileTool(sandbox));

  const llm = new OllamaLlmAdapter(config.ollama);
  const health = await llm.checkHealth();
  for (const warning of health.warnings) {
    renderer.warn(warning);
  }
  if (!health.modelAvailable) {
    renderer.error(
      `Install "${config.ollama.model}" and start the CLI again.`,
    );
    process.exitCode = 1;
    return;
  }

  const executeTool = new ExecuteToolUseCase(registry);
  const sessionStore = new JsonSessionStore(config.sessionDir);

  const sandboxLabel =
    path.relative(process.cwd(), sandbox.root) || path.basename(sandbox.root);
  const systemPrompt = buildSystemPrompt({
    tools: registry.getDefinitions(),
    sandboxLabel,
  });

  const runAgentTurn = new RunAgentTurnUseCase(
    llm,
    registry,
    executeTool,
    {
      maxSteps: config.agent.maxSteps,
      systemPrompt,
      contextLimits: {
        maxMessages: config.agent.maxContextMessages,
        maxContextChars: config.agent.maxContextChars,
        maxObservationChars: config.agent.maxObservationChars,
      },
      maxObservationChars: config.agent.maxObservationChars,
    },
  );

  const repl = new ChatRepl({
    sessionStore,
    sandbox,
    registry,
    runAgentTurn,
    renderer,
    modelName: config.ollama.model,
  });

  await repl.start();
}

main().catch((error: unknown) => {
  console.error(`\nFatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});
