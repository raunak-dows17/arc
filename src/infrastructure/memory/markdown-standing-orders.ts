import { readFile } from "node:fs/promises";
import type { StandingOrdersPort } from "../../application/services/context-assembler-types.js";

/** Reads ARC_HOME/STANDING_ORDERS.md, returning empty text until it exists. */
export class MarkdownStandingOrders implements StandingOrdersPort {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string> {
    try {
      return (await readFile(this.filePath, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
}
