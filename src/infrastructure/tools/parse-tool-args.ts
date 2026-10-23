import type { z } from "zod";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";

export function parseToolArgs<T>(
  schema: z.ZodType<T>,
  args: unknown,
): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ToolValidationError(`Invalid arguments: ${issues}`);
  }
  return parsed.data;
}
