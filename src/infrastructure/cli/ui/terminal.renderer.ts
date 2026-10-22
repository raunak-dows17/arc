import pc from "picocolors";
import { env } from "../../../shared/config/env.js";

export class TerminalRenderer {
  public renderWelcomeBanner(): void {
    console.clear();
    const border = pc.cyan("═".repeat(62));

    console.log(border);
    console.log(
      pc.bold(
        pc.cyan("  🤖 AUTONOMOUS AI AGENT CLI — CLEAN ARCHITECTURE EDITION"),
      ),
    );
    console.log(border);
    console.log(
      `  ${pc.dim("Active Provider:")}  ${pc.green(pc.bold(env.AI_PROVIDER.toUpperCase()))}`,
    );
    console.log(
      `  ${pc.dim("Active Model:")}     ${pc.yellow(env.OLLAMA_MODEL)}`,
    );
    console.log(
      `  ${pc.dim("Max Iterations:")}   ${pc.magenta(String(env.MAX_AGENT_ITERATIONS))}`,
    );
    console.log(
      `  ${pc.dim("Workspace:")}        ${pc.blue("./agent_sandbox")}`,
    );
    console.log(border);
    console.log(
      pc.dim('  Type your objective and press Enter. Type "exit" to quit.\n'),
    );
  }

  public renderObjectiveStart(objective: string, agentId: string): void {
    console.log("\n" + pc.dim("─".repeat(62)));
    console.log(`${pc.bold(pc.cyan("🚀 Objective:"))} ${pc.white(objective)}`);
    console.log(`${pc.dim(`   Session ID: ${agentId}`)}`);
    console.log(pc.dim("─".repeat(62)) + "\n");
  }

  public renderStep(
    message: string,
    type: "thought" | "action" | "observation" | "reflection" | "answer",
  ): void {
    switch (type) {
      case "thought":
        console.log(
          `${pc.yellow(pc.bold("🧠 [THOUGHT]"))}     ${pc.italic(pc.yellow(message))}\n`,
        );
        break;

      case "action":
        console.log(
          `${pc.blue(pc.bold("🛠️  [ACTION]"))}      ${pc.cyan(message)}\n`,
        );
        break;

      case "observation": {
        const preview =
          message.length > 350
            ? message.substring(0, 350) + "... [truncated]"
            : message;
        console.log(
          `${pc.magenta(pc.bold("👁️  [OBSERVATION]"))} ${pc.dim(preview)}\n`,
        );
        break;
      }

      case "reflection":
        console.log(
          `${pc.cyan(pc.bold("🔍 [REFLECTION]"))}  ${pc.cyan(message)}\n`,
        );
        break;

      case "answer":
        console.log(pc.green("━".repeat(62)));
        console.log(`${pc.green(pc.bold("🎯 [FINAL ANSWER]"))}\n`);
        console.log(pc.white(pc.bold(message)));
        console.log(pc.green("━".repeat(62)) + "\n");
        break;
    }
  }

  public renderError(errorMsg: string): void {
    console.log("\n" + pc.red("✖".repeat(62)));
    console.log(
      `${pc.red(pc.bold("❌ [AGENT ERROR]:"))} ${pc.white(errorMsg)}`,
    );
    console.log(pc.red("✖".repeat(62)) + "\n");
  }
}
