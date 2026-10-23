import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { SandboxViolationError } from "../../domain/errors/agent.errors.js";
import { NodeFsSandboxAdapter } from "./node-fs-sandbox.adapter.js";

describe("NodeFsSandboxAdapter", () => {
  let base: string;
  let sandbox: NodeFsSandboxAdapter;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-sandbox-"));
    sandbox = await NodeFsSandboxAdapter.create(path.join(base, "sandbox"));
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("writes, reads, and lists files inside the sandbox", async () => {
    const result = await sandbox.write("notes/hello.md", "# hi\n");

    assert.equal(result.bytes, 5);
    assert.equal(await sandbox.read("notes/hello.md"), "# hi\n");

    const rootEntries = await sandbox.list(".");
    assert.ok(
      rootEntries.some(
        (entry) => entry.path === "notes" && entry.type === "directory",
      ),
    );

    const noteEntries = await sandbox.list("notes");
    assert.ok(
      noteEntries.some(
        (entry) =>
          entry.path === "notes/hello.md" && entry.type === "file",
      ),
    );
  });

  it("rejects traversal, absolute paths, and the reserved state directory", async () => {
    await assert.rejects(
      sandbox.read("../outside.txt"),
      SandboxViolationError,
    );
    await assert.rejects(
      sandbox.write("/tmp/escape.txt", "x"),
      SandboxViolationError,
    );
    await assert.rejects(
      sandbox.write(".agent/sessions/evil.json", "x"),
      SandboxViolationError,
    );
    await assert.rejects(
      sandbox.write(".arc/sessions/evil.json", "x"),
      SandboxViolationError,
    );
    await assert.rejects(
      sandbox.write("notes.txt:secret", "x"),
      SandboxViolationError,
    );
    await assert.rejects(
      sandbox.write("CON", "x"),
      SandboxViolationError,
    );
  });

  it("rejects symlink escapes", async () => {
    const outside = path.join(base, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, path.join(sandbox.root, "link"));

    await assert.rejects(
      sandbox.read("link/secret.txt"),
      SandboxViolationError,
    );
  });

  it("hides the reserved state directory from listings", async () => {
    await mkdir(path.join(sandbox.root, ".agent", "sessions"), {
      recursive: true,
    });

    const entries = await sandbox.list(".");
    assert.ok(entries.every((entry) => entry.name !== ".agent"));
  });

  it("enforces read and write size limits", async () => {
    await assert.rejects(
      sandbox.write("big.txt", "x".repeat(1024 * 1024 + 1)),
      SandboxViolationError,
    );

    await writeFile(
      path.join(sandbox.root, "big-read.txt"),
      "x".repeat(256 * 1024 + 1),
      "utf8",
    );
    await assert.rejects(
      sandbox.read("big-read.txt"),
      SandboxViolationError,
    );
  });
});
