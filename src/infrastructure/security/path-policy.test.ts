import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { SandboxViolationError } from "../../domain/errors/agent.errors.js";
import { PathPolicy } from "../../domain/services/path-policy.js";
import { PolicyEnforcingSandbox } from "../../application/services/policy-enforcing-sandbox.js";
import { NodeFsSandboxAdapter } from "../sandbox/node-fs-sandbox.adapter.js";

describe("PathPolicy", () => {
  const policy = new PathPolicy();

  it("blocks sensitive reads at the root and nested levels", () => {
    assert.equal(policy.isReadable(".env"), false);
    assert.equal(policy.isReadable(".env.local"), false);
    assert.equal(policy.isReadable("config/.env"), false);
    assert.equal(policy.isReadable("secrets/token.txt"), false);
    assert.equal(policy.isReadable("deep/secrets/token.txt"), false);
    assert.equal(policy.isReadable(".git/config"), false);
    assert.equal(policy.isReadable("certs/server.pem"), false);
    assert.equal(policy.isReadable("keys/id_ed25519"), false);
    assert.equal(policy.isReadable("home/.ssh/config"), false);
    assert.equal(policy.isReadable("notes/plan.md"), true);
  });

  it("blocks private keys and ssh material from writes", () => {
    assert.equal(policy.isWritable(".env"), false);
    assert.equal(policy.isWritable("certs/server.pem"), false);
    assert.equal(policy.isWritable("keys/id_ed25519"), false);
    assert.equal(policy.isWritable(".ssh/config"), false);
    assert.equal(policy.isWritable("notes/plan.md"), true);
  });

  it("normalizes traversal before matching sensitive paths", () => {
    assert.equal(policy.isReadable("notes/../.env"), false);
    assert.equal(policy.isReadable("./secrets/../.env"), false);
    assert.equal(policy.isWritable("docs/../.ssh/id_ed25519"), false);
    assert.equal(policy.isReadable("notes/../plan.md"), true);
  });

  it("throws a sandbox violation with a useful message", () => {
    assert.throws(
      () => policy.assertReadable(".env"),
      (error: unknown) =>
        error instanceof SandboxViolationError &&
        /sensitive path/.test(error.message),
    );
  });
});

describe("PolicyEnforcingSandbox", () => {
  let base: string;
  let sandbox: PolicyEnforcingSandbox;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "agent-policy-"));
    await mkdir(path.join(base, "sandbox", "secrets"), { recursive: true });
    await writeFile(path.join(base, "sandbox", ".env"), "TOKEN=x", "utf8");
    await writeFile(
      path.join(base, "sandbox", "secrets", "key.txt"),
      "secret",
      "utf8",
    );
    await writeFile(path.join(base, "sandbox", "notes.md"), "hello", "utf8");
    await symlink(".env", path.join(base, "sandbox", "leak.txt"));
    const policy = new PathPolicy();
    const inner = await NodeFsSandboxAdapter.create(
      path.join(base, "sandbox"),
      policy,
    );
    sandbox = new PolicyEnforcingSandbox(inner, policy);
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("hides blocked entries from listings", async () => {
    const entries = await sandbox.list(".");
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["notes.md"],
    );
  });

  it("blocks reads and writes through the sandbox", async () => {
    await assert.rejects(sandbox.read(".env"), SandboxViolationError);
    await assert.rejects(
      sandbox.write(".git/config", "x"),
      SandboxViolationError,
    );
    assert.equal(await sandbox.read("notes.md"), "hello");
  });

  it("blocks a symlink that points at a sensitive file", async () => {
    await assert.rejects(sandbox.read("leak.txt"), SandboxViolationError);
  });
});
