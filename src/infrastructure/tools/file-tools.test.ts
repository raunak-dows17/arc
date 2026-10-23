import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { SandboxViolationError, ToolValidationError } from "../../domain/errors/agent.errors.js";
import { NodeFsSandboxAdapter } from "../sandbox/node-fs-sandbox.adapter.js";
import { ListFilesTool } from "./list-files.tool.js";
import { ReadFileTool } from "./read-file.tool.js";
import { WriteFileTool } from "./write-file.tool.js";

describe("file tools", () => {
  let base: string;
  let writeTool: WriteFileTool;
  let readTool: ReadFileTool;
  let listTool: ListFilesTool;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-tools-"));
    const sandbox = await NodeFsSandboxAdapter.create(path.join(base, "sandbox"));
    writeTool = new WriteFileTool(sandbox);
    readTool = new ReadFileTool(sandbox);
    listTool = new ListFilesTool(sandbox);
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("writes, reads, and lists a file", async () => {
    const writeResult = await writeTool.execute({
      path: "notes/todo.md",
      content: "one\ntwo\nthree\n",
    });
    assert.match(writeResult, /Wrote 14 bytes/);

    const readResult = await readTool.execute({
      path: "notes/todo.md",
      start_line: 2,
      line_count: 1,
    });
    assert.match(readResult, /lines 2-2 of 3/);
    assert.match(readResult, /2 \| two/);
    assert.match(readResult, /more line/);

    const listResult = await listTool.execute({ path: "notes" });
    assert.match(listResult, /\[file\] notes\/todo\.md \(14 bytes\)/);
  });

  it("rejects invalid tool arguments", async () => {
    await assert.rejects(readTool.execute({}), ToolValidationError);
    await assert.rejects(
      writeTool.execute({ path: "a.txt" }),
      ToolValidationError,
    );
  });

  it("propagates sandbox violations", async () => {
    await assert.rejects(
      writeTool.execute({ path: "../escape.txt", content: "nope" }),
      SandboxViolationError,
    );
    await assert.rejects(
      listTool.execute({ path: "/tmp" }),
      SandboxViolationError,
    );
  });
});
