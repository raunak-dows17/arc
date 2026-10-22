import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { FileRecoveryStore } from "./file-recovery.store.js";

async function withStore(
  run: (sandboxDir: string, store: FileRecoveryStore) => Promise<void>,
): Promise<void> {
  const sandboxDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "agent-file-recovery-"),
  );
  try {
    await run(sandboxDir, new FileRecoveryStore(sandboxDir));
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  }
}

test("rollback removes a file created by a verified write", async () => {
  await withStore(async (sandboxDir, store) => {
    const result = await store.writeAndVerify("todo.txt", "Three habits");
    assert.equal(
      await fs.readFile(path.join(sandboxDir, "todo.txt"), "utf8"),
      "Three habits",
    );

    await store.rollback(result.actionId);

    await assert.rejects(fs.access(path.join(sandboxDir, "todo.txt")));
  });
});

test("rollback restores the exact previous contents", async () => {
  await withStore(async (sandboxDir, store) => {
    const filePath = path.join(sandboxDir, "todo.txt");
    await fs.writeFile(filePath, "Original contents", "utf8");
    const result = await store.writeAndVerify("todo.txt", "Replacement");

    await store.rollback(result.actionId);

    assert.equal(await fs.readFile(filePath, "utf8"), "Original contents");
  });
});

test("rollback refuses to overwrite changes made after the agent write", async () => {
  await withStore(async (sandboxDir, store) => {
    const filePath = path.join(sandboxDir, "todo.txt");
    const result = await store.writeAndVerify("todo.txt", "Agent contents");
    await fs.writeFile(filePath, "User's newer contents", "utf8");

    await assert.rejects(
      store.rollback(result.actionId),
      /Rollback refused because the file changed/,
    );
    assert.equal(
      await fs.readFile(filePath, "utf8"),
      "User's newer contents",
    );
  });
});

test("rollback is idempotent after a successful restore", async () => {
  await withStore(async (sandboxDir, store) => {
    const filePath = path.join(sandboxDir, "todo.txt");
    await fs.writeFile(filePath, "Original contents", "utf8");
    const result = await store.writeAndVerify("todo.txt", "Replacement");

    await store.rollback(result.actionId);
    await store.rollback(result.actionId);

    assert.equal(await fs.readFile(filePath, "utf8"), "Original contents");
  });
});
