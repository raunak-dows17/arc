import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";
import { NodeFsSandboxAdapter } from "../sandbox/node-fs-sandbox.adapter.js";
import { ReplaceInFileTool } from "./replace-in-file.tool.js";

describe("ReplaceInFileTool", () => {
  let base: string;
  let sandbox: NodeFsSandboxAdapter;
  let tool: ReplaceInFileTool;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "arc-replace-"));
    sandbox = await NodeFsSandboxAdapter.create(path.join(base, "workspace"));
    tool = new ReplaceInFileTool(sandbox);
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("replaces one unique exact match", async () => {
    await sandbox.write("src/app.ts", "const model = 'qwen3:8b';\n");
    const result = await tool.execute({
      path: "src/app.ts",
      old_string: "'qwen3:8b'",
      new_string: "'qwen2.5-coder:7b'",
    });

    assert.match(result, /Replaced 1 occurrence/);
    assert.equal(
      await sandbox.read("src/app.ts"),
      "const model = 'qwen2.5-coder:7b';\n",
    );
  });

  it("rejects a missing match and a non-unique match", async () => {
    await sandbox.write("src/notes.md", "arc\narc\n");

    await assert.rejects(
      tool.execute({
        path: "src/notes.md",
        old_string: "missing",
        new_string: "x",
      }),
      ToolValidationError,
    );
    await assert.rejects(
      tool.execute({
        path: "src/notes.md",
        old_string: "arc",
        new_string: "ARC",
      }),
      /matches 2 times/,
    );
  });

  it("can replace every occurrence when explicitly requested", async () => {
    await sandbox.write("src/all.md", "arc arc arc");
    const result = await tool.execute({
      path: "src/all.md",
      old_string: "arc",
      new_string: "ARC",
      replace_all: true,
    });

    assert.match(result, /Replaced 3 occurrence/);
    assert.equal(await sandbox.read("src/all.md"), "ARC ARC ARC");
  });
});
