import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";

const DEFAULT_STANDING_ORDERS = [
  "# Standing orders",
  "",
  "- Be concise, concrete, and honest about uncertainty.",
  "- Keep durable facts in Markdown memory; do not rely on chat history alone.",
  "- Ask before destructive or externally visible actions.",
  "- Prefer reading existing files before changing them.",
  "- Delegate only self-contained work; sub-agents run one at a time and cannot spawn more agents.",
  "- Never expose secrets. Sensitive files are blocked by policy.",
  "",
].join("\n");

/**
 * Creates private agent state outside the workspace. Existing files are never
 * overwritten, so the user can edit standing orders and memory safely.
 */
export async function ensureAgentHome(config: AppConfig): Promise<void> {
  await Promise.all([
    mkdir(config.agentHome, { recursive: true }),
    mkdir(config.sessionDir, { recursive: true }),
    mkdir(config.runDir, { recursive: true }),
    mkdir(config.memoryDir, { recursive: true }),
    mkdir(config.skillsDir, { recursive: true }),
    mkdir(config.agentsDir, { recursive: true }),
  ]);

  try {
    await writeFile(config.standingOrdersPath, DEFAULT_STANDING_ORDERS, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  await migrateLegacySessions(config);
}

/**
 * Earlier versions stored transcripts in WORKSPACE/.agent/sessions. Copy them
 * once into AGENT_HOME/sessions when the new store has no sessions yet.
 */
async function migrateLegacySessions(config: AppConfig): Promise<void> {
  const existing = await readdir(config.sessionDir).catch(() => [] as string[]);
  if (existing.some((name) => name.endsWith(".json"))) {
    return;
  }

  const legacyDirectory = path.join(config.workspaceDir, ".agent", "sessions");
  const legacy = await readdir(legacyDirectory).catch(() => [] as string[]);
  for (const name of legacy) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      await copyFile(
        path.join(legacyDirectory, name),
        path.join(config.sessionDir, name),
      );
    } catch {
      // A single unreadable legacy session must not block startup.
    }
  }
}
