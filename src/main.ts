import { ExecuteAgentLoopUseCase } from "./application/usecases/execute_agent_loop.usecase.js";
import { ReflectionOnTaskUsecase } from "./application/usecases/reflect_on_task.usecase.js";
import { RegisterToolUseCase } from "./application/usecases/register_tool.usecase.js";
import { LLMFactory } from "./infrastructure/ai/llm.factory.js";
import { RunAgentCommand } from "./infrastructure/cli/commands/run-agent.command.js";
import { TerminalRenderer } from "./infrastructure/cli/ui/terminal.renderer.js";
import { InMemoryVectorAdapter } from "./infrastructure/memory/in-memory-vector.adapter.js";
import { FileReaderTool } from "./infrastructure/tools/file_reader.tool.js";
import { FileWriterTool } from "./infrastructure/tools/file_writer.tool.js";
import { ListFilesTool } from "./infrastructure/tools/list-files.tool.js";
import { WebSearchTool } from "./infrastructure/tools/web_search.tool.js";
import { UndoFileWriteTool } from "./infrastructure/tools/undo-file-write.tool.js";

export async function bootstrap(): Promise<void> {
  // 1. Initialize Infrastructure Adapters
  const llmProvider = LLMFactory.create();
  const vectorStore = new InMemoryVectorAdapter();

  // 2. Initialize & Register All Agent Tools
  const toolRegistry = new RegisterToolUseCase();
  await toolRegistry.execute(new FileWriterTool());
  await toolRegistry.execute(new UndoFileWriteTool());
  await toolRegistry.execute(new FileReaderTool());
  await toolRegistry.execute(new ListFilesTool());
  await toolRegistry.execute(new WebSearchTool());

  // 3. Initialize Application Use Cases
  const reflectUseCase = new ReflectionOnTaskUsecase(llmProvider);
  const executeAgentLoopUseCase = new ExecuteAgentLoopUseCase(
    llmProvider,
    toolRegistry,
    reflectUseCase,
    vectorStore,
  );

  // 4. Initialize CLI UI & Controller
  const renderer = new TerminalRenderer();
  const cliCommand = new RunAgentCommand(executeAgentLoopUseCase, renderer);

  // 5. Check if user passed a single command argument or wants Interactive Mode
  const cliArgs = process.argv.slice(2).join(" ").trim();
  if (cliArgs) {
    await cliCommand.executeSingleObjective(cliArgs);
  } else {
    await cliCommand.startInteractiveSession();
  }
}
