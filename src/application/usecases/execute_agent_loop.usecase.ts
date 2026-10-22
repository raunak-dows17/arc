import * as crypto from "crypto";
import path from "node:path";
import type { LLMPort } from "../../domain/ports/llm.port.js";
import type { RegisterToolUseCase } from "./register_tool.usecase.js";
import type { ReflectionOnTaskUsecase } from "./reflect_on_task.usecase.js";
import type { VectorStorePort } from "../../domain/ports/vector_store.port.js";
import type { RunAgentDTO } from "../dtos/run_agent.dto.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";
import { AgentEntity } from "../../domain/entities/agent.entities.js";
import { env } from "../../shared/config/env.js";
import { MemoryEntity } from "../../domain/entities/memory.entities.js";
import { PromptVO } from "../../domain/value_objects/prompt.vo.js";
import { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";
import { ToolExecutionError } from "../../domain/errors/agent.errors.js";

export interface StepCallback {
  onStepUpdate: (
    message: string,
    type: "thought" | "action" | "observation" | "reflection" | "answer",
  ) => void;
}

function getToolsRequestedByObjective(
  objective: string,
  tools: ReturnType<RegisterToolUseCase["getAllDefinitions"]>,
) {
  const requestsFileOperation =
    /\b(?:file|files|sandbox)\b|\b[\w-]+\.(?:txt|md|json|csv|html|ts|js)\b/i.test(
      objective,
    );
  const requestsWebSearch =
    /\b(?:web|internet|online|browse|browser|search|research|latest|current|today|recent|news)\b/i.test(
      objective,
    );

  return tools.filter(({ name }) => {
    if (name === "web_search") {
      return requestsWebSearch;
    }
    if (name === "undo_file_write") {
      return (
        /\b(?:undo|revert|rollback|restore)\b/i.test(objective) &&
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
          objective,
        )
      );
    }
    if (!requestsFileOperation) {
      return false;
    }
    if (name === "file_writer") {
      return /\b(?:write|create|save|append|edit|update|overwrite)\b/i.test(
        objective,
      );
    }
    if (name === "file_reader") {
      return /\b(?:read|open|inspect|review|summarize|analyze)\b/i.test(
        objective,
      );
    }
    if (name === "list_files") {
      return /\b(?:list|show|display)\b/i.test(objective);
    }
    return false;
  });
}

export class ExecuteAgentLoopUseCase {
  constructor(
    private readonly llmProvider: LLMPort,
    private readonly toolRegistry: RegisterToolUseCase,
    private readonly reflectOnTaskUseCase: ReflectionOnTaskUsecase,
    private readonly vectorStore?: VectorStorePort,
  ) {}

  public async execute(
    input: RunAgentDTO,
    callbacks: StepCallback,
  ): Promise<string> {
    agentLogger.info("Initializing agent execution loop pipeline", {
      agentId: input.agentId,
    });

    // Initialize the core domain entities using validated environment limits
    const agent = new AgentEntity({
      id: input.agentId,
      goal: input.objective,
      maxIterations: env.MAX_AGENT_ITERATIONS,
      currentIteration: 0,
      tasks: [],
    });

    const memory = new MemoryEntity({
      id: crypto.randomUUID(),
      agentId: agent.id,
      conversationHistory: [],
    });

    // 1. Fetch context from long-term memory if vector store is available
    let longTermContext = "";
    if (this.vectorStore) {
      const pastMemories = await this.vectorStore.searchSimilar({
        text: input.objective,
        limit: 3,
        filter: { agentId: agent.id },
      });
      if (pastMemories.length > 0) {
        longTermContext = pastMemories.map((m) => m.content).join("\n");
      }
    }

    // 2. Expose only tools explicitly relevant to the requested objective
    const availableTools = getToolsRequestedByObjective(
      agent.goal,
      this.toolRegistry.getAllDefinitions(),
    );
    const toolsSchemaString =
      availableTools.length > 0
        ? JSON.stringify(availableTools, null, 2)
        : "No tools are available for this task.";

    // 3. Compile dynamic system prompt using Value Object
    const systemPromptVO = new PromptVO({
      template: [
        "You are an autonomous AI agent tasked to achieve: {{goal}}.",
        "",
        "Relevant past experiences:",
        "{{context}}",
        "",
        "Available Tools:",
        "{{tools}}",
        "",
        "Follow the user's requested output format, count, length, and other constraints exactly. finalAnswer must contain only the requested deliverable, without extra commentary unless requested.",
        "Choose exactly one response: call one listed tool, or provide finalAnswer. Do not call tools for a task that can be answered directly.",
        "The top-level JSON value must be one object, never an array. Include thought only as a brief action note, not hidden reasoning. Return valid JSON matching this schema (no comments or additional properties):",
        "{",
        '  "thought": "Brief summary of the next action",',
        '  "toolToCall": { "name": "tool_name", "arguments": {} },',
        '  "finalAnswer": "The requested deliverable"',
        "}",
      ].join("\n"),
      variables: {
        goal: agent.goal,
        context: longTermContext || "No past relevant experiences found.",
        tools: toolsSchemaString,
      },
    });

    memory.addMessage({ role: "user", content: input.objective });
    const completedToolCalls = new Map<string, string>();
    const fileWriteActions = new Map<string, string>();
    const userAuthorizedRecoveryIds = new Set(
      input.objective.match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ) ?? [],
    );
    let rollbackAuthorized =
      userAuthorizedRecoveryIds.size > 0 &&
      /\b(?:undo|revert|rollback|restore)\b/i.test(input.objective);

    // 4. Main ReAct (Reason + Act + Reflect) Execution Loop
    while (true) {
      try {
        agent.incrementIteration();
        agentLogger.step(
          agent.currentIteration,
          "Querying LLM provider for next decision",
        );

        const decision = await this.llmProvider.generateDecision({
          messages: memory.conversationHistory,
          systemPrompt: systemPromptVO.toString(),
        });

        callbacks.onStepUpdate(decision.thought, "thought");
        memory.addMessage({
          role: "assistant",
          content: JSON.stringify({
            thought: decision.thought,
            ...(decision.toolToCall
              ? { toolToCall: decision.toolToCall }
              : {}),
            ...(decision.finalAnswer
              ? { finalAnswer: decision.finalAnswer }
              : {}),
          }),
        });

        // Branch A: Agent proposes a final answer -> Trigger Self-Reflection before accepting
        if (decision.finalAnswer) {
          callbacks.onStepUpdate(
            "Evaluating proposed final answer against objective...",
            "reflection",
          );

          const reflection = await this.reflectOnTaskUseCase.execute({
            taskDescription: agent.goal,
            executionOutput: decision.finalAnswer,
          });

          if (reflection.isValid) {
            callbacks.onStepUpdate(
              `Reflection passed: ${reflection.critique}`,
              "reflection",
            );
            callbacks.onStepUpdate(decision.finalAnswer, "answer");

            if (this.vectorStore) {
              await this.vectorStore.addDocument({
                content: `Objective: ${agent.goal} | Resolved Answer: ${decision.finalAnswer}`,
                metadata: { agentId: agent.id, status: "success" },
              });
            }

            return decision.finalAnswer;
          } else {
            // Reflection rejected the final answer; feed critique back into working memory
            rollbackAuthorized = fileWriteActions.size > 0;
            const recoveryInstruction = rollbackAuthorized
              ? ` A file written during this run may be rolled back with undo_file_write using one of these action IDs: ${Array.from(fileWriteActions.keys()).join(", ")}. Only roll it back if the file contents are incorrect; otherwise correct the unmet requirements.`
              : "";
            const rejectionMessage = `Self-Reflection Rejected Final Answer. Critique: ${reflection.critique}. Please address the missing requirements and try again.${recoveryInstruction}`;
            callbacks.onStepUpdate(rejectionMessage, "reflection");

            memory.addMessage({
              role: "user",
              content: rejectionMessage,
            });

            // Continue to the next iteration so the agent can self-correct
            continue;
          }
        }

        // Branch B: Agent decided to invoke a tool
        if (decision.toolToCall) {
          if (
            !availableTools.some(
              (tool) => tool.name === decision.toolToCall?.name,
            )
          ) {
            const rejectionMessage =
              "That tool was not explicitly requested or is unavailable for this task. Do not call tools; provide the requested finalAnswer directly.";
            callbacks.onStepUpdate(rejectionMessage, "observation");
            memory.addMessage({ role: "user", content: rejectionMessage });
            continue;
          }

          const toolCallVO = new ToolCallVO({
            name: decision.toolToCall.name,
            arguments: decision.toolToCall.arguments || {},
          });
          if (toolCallVO.name === "undo_file_write") {
            const actionId = toolCallVO.arguments.actionId;
            if (
              !rollbackAuthorized ||
              typeof actionId !== "string" ||
              (!fileWriteActions.has(actionId) &&
                !userAuthorizedRecoveryIds.has(actionId))
            ) {
              const rejectionMessage =
                "Rollback is not authorized for that action. Only roll back a file write from this run after verification fails or the user explicitly requests it.";
              callbacks.onStepUpdate(rejectionMessage, "observation");
              memory.addMessage({ role: "user", content: rejectionMessage });
              continue;
            }
          }

          const toolCallKey =
            toolCallVO.name === "file_writer"
              ? `${toolCallVO.name}:${path.basename(String(toolCallVO.arguments.filename))}`
              : `${toolCallVO.name}:${JSON.stringify(toolCallVO.arguments)}`;
          const previousResult = completedToolCalls.get(toolCallKey);

          if (previousResult !== undefined) {
            const repeatedCallMessage =
              `This action was already completed and must not be repeated. Previous result: ${previousResult}. Continue with any remaining requested work or provide the final answer.`;
            callbacks.onStepUpdate(repeatedCallMessage, "observation");
            memory.addMessage({
              role: "tool",
              name: toolCallVO.name,
              content: repeatedCallMessage,
            });
            continue;
          }

          callbacks.onStepUpdate(
            `Calling tool [${toolCallVO.name}] with args: ${JSON.stringify(toolCallVO.arguments)}`,
            "action",
          );

          const targetTool = this.toolRegistry.getTool(toolCallVO.name);
          let observationResult: string;

          if (!targetTool) {
            observationResult = `Tool Error: Tool [${toolCallVO.name}] is not registered. Available tools: ${availableTools.map((t) => t.name).join(", ")}`;
            agentLogger.error(observationResult);
          } else {
            try {
              observationResult = await targetTool.execute(toolCallVO);
            } catch (toolErr: any) {
              const domainToolErr = new ToolExecutionError(
                toolCallVO.name,
                toolErr.message,
              );
              observationResult = domainToolErr.message;
              agentLogger.error(
                "Tool execution failed inside loop",
                domainToolErr,
              );
            }
          }

          callbacks.onStepUpdate(observationResult, "observation");

          // Feed the tool output back into the agent's short-term working memory
          memory.addMessage({
            role: "tool",
            name: toolCallVO.name,
            content: observationResult,
          });

          if (toolCallVO.name === "file_writer") {
            const actionId = observationResult.match(
              /Recovery action ID: ([0-9a-f-]{36})/i,
            )?.[1];
            if (actionId) {
              const filename = path.basename(
                String(toolCallVO.arguments.filename),
              );
              fileWriteActions.set(actionId, filename);
            }
            if (observationResult.startsWith("Success:")) {
              completedToolCalls.set(toolCallKey, observationResult);
            } else {
              rollbackAuthorized = actionId !== undefined;
              if (rollbackAuthorized) {
                if (observationResult.startsWith("Success:")) {
                  completedToolCalls.set(toolCallKey, observationResult);
                }
                const retryMessage =
                  `${observationResult} The write was not verified. Diagnose the failure; use undo_file_write with the recovery action ID if restoration is needed, then retry only after rollback succeeds.`;
                callbacks.onStepUpdate(retryMessage, "observation");
                memory.addMessage({
                  role: "user",
                  content: retryMessage,
                });
              }
            }
          } else if (toolCallVO.name === "undo_file_write") {
            if (observationResult.startsWith("Success:")) {
              const actionId = String(toolCallVO.arguments.actionId);
              const filename = fileWriteActions.get(actionId);
              fileWriteActions.delete(actionId);
              if (filename) {
                completedToolCalls.delete(`file_writer:${filename}`);
              }
              rollbackAuthorized = false;
            }
            completedToolCalls.set(toolCallKey, observationResult);
          } else if (
            !observationResult.startsWith("Tool Error:") &&
            !observationResult.startsWith("IO Error:") &&
            !observationResult.startsWith("Error:")
          ) {
            completedToolCalls.set(toolCallKey, observationResult);
          }
        }

        if (!decision.finalAnswer && !decision.toolToCall) {
          const retryMessage =
            "Your last response did not include a finalAnswer or toolToCall. Re-evaluate the task and return exactly one valid action.";
          callbacks.onStepUpdate(retryMessage, "reflection");
          memory.addMessage({ role: "user", content: retryMessage });
        }
      } catch (error: any) {
        agentLogger.error("Execution breakpoint hit inside agent loop", error);
        throw error;
      }
    }
  }
}
