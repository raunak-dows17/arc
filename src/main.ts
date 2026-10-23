import { realpath } from "node:fs/promises";
import path from "node:path";
import { ApprovalService, DenyAllApprovalPrompt } from "./application/services/approval.service.js";
import { ContextAssembler } from "./application/services/context-assembler.js";
import { ModelRouter } from "./application/services/model-router.js";
import { PolicyEnforcingSandbox } from "./application/services/policy-enforcing-sandbox.js";
import { ToolRegistry } from "./application/services/tool-registry.js";
import { CompactSessionUseCase } from "./application/usecases/compact-session.usecase.js";
import { ExecuteToolUseCase } from "./application/usecases/execute-tool.usecase.js";
import { RunAgentTurnUseCase } from "./application/usecases/run-agent-turn.usecase.js";
import { SubAgentRunner } from "./application/usecases/sub-agent-runner.js";
import { PathPolicy } from "./domain/services/path-policy.js";
import { ensureArcHome } from "./infrastructure/bootstrap/arc-home.js";
import { ChatRepl } from "./infrastructure/cli/repl.js";
import { printDoctorReport, runDoctor } from "./infrastructure/cli/doctor.js";
import { TerminalRenderer } from "./infrastructure/cli/terminal.renderer.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { InMemoryEventBus } from "./infrastructure/events/in-memory-event-bus.js";
import { JsonlAuditLogger } from "./infrastructure/events/jsonl-audit.logger.js";
import { OllamaDecisionAdapter } from "./infrastructure/llm/ollama-decision.adapter.js";
import { OllamaLlmAdapter } from "./infrastructure/llm/ollama.adapter.js";
import { SerializedLlmAdapter } from "./infrastructure/llm/serialized-llm.adapter.js";
import { FileMemoryStore } from "./infrastructure/memory/file-memory.store.js";
import { MarkdownStandingOrders } from "./infrastructure/memory/markdown-standing-orders.js";
import { JsonSessionStore } from "./infrastructure/persistence/json-session.store.js";
import { JsonSubAgentRepository } from "./infrastructure/persistence/json-sub-agent.repository.js";
import { MarkdownAgentProfileRepository } from "./infrastructure/profiles/markdown-profile.repository.js";
import { NodeFsSandboxAdapter } from "./infrastructure/sandbox/node-fs-sandbox.adapter.js";
import { MarkdownSkillRepository } from "./infrastructure/skills/markdown-skill.repository.js";
import { ListFilesTool } from "./infrastructure/tools/list-files.tool.js";
import { LoadSkillTool } from "./infrastructure/tools/load-skill.tool.js";
import { MemoryGetTool, MemorySearchTool } from "./infrastructure/tools/memory-search.tool.js";
import { ReadFileTool } from "./infrastructure/tools/read-file.tool.js";
import { RememberTool } from "./infrastructure/tools/remember.tool.js";
import { RunAgentTool } from "./infrastructure/tools/run-agent.tool.js";
import { WriteFileTool } from "./infrastructure/tools/write-file.tool.js";
import { errorMessage } from "./shared/text.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const renderer = new TerminalRenderer();

  if (process.argv[2] === "doctor") {
    await ensureArcHome(config);
    const report = await runDoctor(config);
    printDoctorReport(report);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  await ensureArcHome(config);

  const memory = new FileMemoryStore(config.memoryDir);
  await memory.initialize();

  const policy = new PathPolicy();
  const innerSandbox = await NodeFsSandboxAdapter.create(
    config.workspaceDir,
    policy,
  );
  const sandbox = new PolicyEnforcingSandbox(innerSandbox, policy);
  const realArcHome = await realpath(config.arcHome);
  if (
    realArcHome === sandbox.root ||
    realArcHome.startsWith(`${sandbox.root}${path.sep}`)
  ) {
    renderer.error(
      "ARC_HOME resolves inside the workspace. Private state must stay outside the filesystem sandbox.",
    );
    process.exitCode = 1;
    return;
  }

  const events = new InMemoryEventBus();
  const audit = new JsonlAuditLogger(config.auditLogPath);
  events.on("*", (event) => audit.recordSafely(event));

  const profiles = new MarkdownAgentProfileRepository(config.agentsDir);
  await profiles.reload();
  const defaultProfile = await profiles.get(config.agent.defaultProfileId);
  if (!defaultProfile) {
    renderer.error(
      `ARC profile "${config.agent.defaultProfileId}" was not found. Check ARC_PROFILE or ARC_HOME/agents.`,
    );
    process.exitCode = 1;
    return;
  }

  const skills = new MarkdownSkillRepository([
    config.builtinSkillsDir,
    config.skillsDir,
    path.join(config.workspaceDir, ".skills"),
  ]);
  await skills.reload();

  const standingOrders = new MarkdownStandingOrders(config.standingOrdersPath);

  const registry = new ToolRegistry();
  registry.register(new ListFilesTool(sandbox));
  registry.register(new ReadFileTool(sandbox));
  registry.register(new WriteFileTool(sandbox));
  registry.register(new MemorySearchTool(memory));
  registry.register(new MemoryGetTool(memory));
  registry.register(new RememberTool(memory, events));
  registry.register(new LoadSkillTool(skills));

  const rawLlm = new OllamaLlmAdapter(config.ollama);
  const health = await rawLlm.checkHealth([
    config.ollama.model,
    config.ollama.codingModel,
    config.ollama.researchModel,
    config.ollama.decisionModel,
  ]);
  for (const warning of health.warnings) {
    renderer.warn(warning);
  }
  if (health.missingModels.includes(config.ollama.model)) {
    renderer.error(
      `Install "${config.ollama.model}" and start ARC again.`,
    );
    process.exitCode = 1;
    return;
  }

  const decisionModel = new OllamaDecisionAdapter({
    baseUrl: config.ollama.decisionBaseUrl,
    model: config.ollama.decisionModel,
    keepAlive: config.ollama.keepAlive,
    timeoutMs: config.ollama.timeoutMs,
  });
  const llm = new SerializedLlmAdapter(rawLlm, decisionModel);
  const modelRouter = new ModelRouter({
    main: config.ollama.model,
    research: config.ollama.researchModel,
    coding: config.ollama.codingModel,
    decision: config.ollama.decisionModel,
  });
  const sessionStore = new JsonSessionStore(config.sessionDir);
  const subAgentRuns = new JsonSubAgentRepository(config.runDir);
  const approvals = new ApprovalService(new DenyAllApprovalPrompt());

  const relativeWorkspace =
    path.relative(process.cwd(), sandbox.root) || path.basename(sandbox.root);
  const workspaceLabel = relativeWorkspace.startsWith("..")
    ? sandbox.root
    : relativeWorkspace;

  const assembler = new ContextAssembler({
    registry,
    skills,
    memory,
    standingOrders,
    workspaceLabel,
    options: {
      maxMessages: config.agent.maxContextMessages,
      maxContextChars: config.agent.maxContextChars,
      maxObservationChars: config.agent.maxObservationChars,
      maxMemoryChars: config.agent.maxMemoryChars,
      maxSkillIndexChars: config.agent.maxSkillIndexChars,
    },
  });

  const compacter = new CompactSessionUseCase(llm, {
    thresholdChars: config.agent.compactAtChars,
    keepRecentMessages: config.agent.keepRecentMessages,
  });

  const executeTool = new ExecuteToolUseCase(registry, approvals);
  const subAgentRunner = new SubAgentRunner(
    {
      profiles,
      sessions: sessionStore,
      runs: subAgentRuns,
      registry,
      executeTool,
      llm,
      assembler,
      compacter,
      events,
      modelRouter,
    },
    {
      maxDepth: config.subAgents.maxDepth,
      maxSteps: config.subAgents.maxSteps,
      maxRunMs: config.subAgents.maxRunMs,
      maxObservationChars: config.agent.maxObservationChars,
    },
  );
  registry.register(new RunAgentTool(subAgentRunner));

  const runAgentTurn = new RunAgentTurnUseCase(
    llm,
    registry,
    executeTool,
    {
      maxSteps: config.agent.maxSteps,
      maxObservationChars: config.agent.maxObservationChars,
      maxSubAgentsPerTurn: config.subAgents.maxPerTurn,
      assembler,
      compacter,
      events,
      modelRouter,
    },
  );

  const repl = new ChatRepl({
    sessionStore,
    sandbox,
    registry,
    runAgentTurn,
    renderer,
    modelName: config.ollama.model,
    arcHome: config.arcHome,
    defaultProfileId: config.agent.defaultProfileId,
    profiles,
    skills,
    memory,
    compacter,
    subAgentRuns,
    subAgentRunner,
    assembler,
    events,
    memoryAutoCapture: config.agent.memoryAutoCapture,
  });

  await repl.start();
}

main().catch((error: unknown) => {
  console.error(`\nFatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});
