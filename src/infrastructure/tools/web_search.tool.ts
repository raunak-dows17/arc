import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import type { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

export class WebSearchTool implements ToolPort {
  constructor() {}

  public getDefinition(): ToolDefinition {
    return {
      name: "web_search",
      description:
        "Executes live web search operations against actual online resources using agentic data streams without an API Key requirement.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The absolute raw string search search query formulation (e.g., nodejs latest release version)",
          },
        },
        required: ["query"],
      },
    };
  }

  public async execute(toolCall: ToolCallVO): Promise<string> {
    const queryStr = toolCall.arguments.query;
    agentLogger.debug(
      "Initiating real-time keyless Tavily network search query trace execution",
      { queryStr },
    );

    try {
      // Utilizing Tavily keyless agent optimization gateway mode over standard fetch primitives
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tavily-Access-Mode": "keyless", // Activates absolute free tier execution vectors
        },
        body: JSON.stringify({
          query: queryStr,
          search_depth: "basic",
          max_results: 3,
        }),
      });

      if (!response.ok) {
        return `Network Search Warning: Gateway response rejected search stack verification with code: ${response.status}`;
      }

      const payload = (await response.json()) as any;
      const searchResultsArray = payload.results || [];

      if (searchResultsArray.length === 0) {
        return `Web Search Status: No results matching query string context found online for [${queryStr}].`;
      }

      // Formatting down structured items cleanly into string context maps for model token efficiency
      const formattedOutputString = searchResultsArray
        .map(
          (item: any, idx: number) =>
            `Result [${idx + 1}]:\nTitle: ${item.title}\nURL: ${item.url}\nExcerpt snippet: ${item.content}`,
        )
        .join("\n\n");

      return `Live search indexing data records for query context [${queryStr}]:\n\n${formattedOutputString}`;
    } catch (error: any) {
      agentLogger.error(
        "Fatal internal networking exception broken during external query transport parsing",
        error,
      );
      return `Search Engine Integration Interruption: Unable to parse query request sequence safely: ${error.message}`;
    }
  }
}
