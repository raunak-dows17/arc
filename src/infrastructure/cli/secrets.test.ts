import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemorySecretStore } from "../secrets/in-memory.secret-store.js";
import { SECRET_ACCOUNTS } from "../../shared/secret-accounts.js";
import { runSecretsCommand } from "./secrets.js";

function harness(store = new InMemorySecretStore()): {
  store: InMemorySecretStore;
  output: () => string;
  run: (args: string[], secret?: string) => Promise<number>;
} {
  let output = "";
  return {
    store,
    output: () => output,
    run: (args, secret = "test-secret-value") =>
      runSecretsCommand(store, args, {
        output: (text) => {
          output += text;
        },
        readSecret: async () => secret,
      }),
  };
}

describe("arc secrets", () => {
  it("stores a secret without echoing it", async () => {
    const cli = harness();
    const code = await cli.run(["set", SECRET_ACCOUNTS.braveApiKey]);

    assert.equal(code, 0);
    assert.equal(
      await cli.store.get(SECRET_ACCOUNTS.braveApiKey),
      "test-secret-value",
    );
    assert.match(cli.output(), /Stored brave\.api-key/);
    assert.doesNotMatch(cli.output(), /test-secret-value/);
  });

  it("checks, lists, and deletes a secret", async () => {
    const cli = harness();
    await cli.run(["set", SECRET_ACCOUNTS.braveApiKey]);
    await cli.run(["check", SECRET_ACCOUNTS.braveApiKey]);
    assert.match(cli.output(), /brave\.api-key: set/);

    await cli.run(["list"]);
    assert.match(cli.output(), /\[set\s*\] brave\.api-key/);
    assert.match(cli.output(), /\[missing\s*\] gmail\.app-password/);

    await cli.run(["delete", SECRET_ACCOUNTS.braveApiKey]);
    assert.match(cli.output(), /Deleted brave\.api-key/);
    assert.equal(await cli.store.get(SECRET_ACCOUNTS.braveApiKey), null);
  });

  it("rejects secrets passed as arguments and unknown accounts", async () => {
    const cli = harness();
    const leaked = await cli.run([
      "set",
      SECRET_ACCOUNTS.braveApiKey,
      "do-not-put-this-in-history",
    ]);
    assert.equal(leaked, 1);
    assert.match(cli.output(), /Do not pass secrets as arguments/);
    assert.equal(await cli.store.get(SECRET_ACCOUNTS.braveApiKey), null);

    const unknown = await cli.run(["set", "unknown.key"]);
    assert.equal(unknown, 1);
    assert.match(cli.output(), /Unknown account/);
  });

  it("rejects an empty or very short secret", async () => {
    const cli = harness();
    const code = await cli.run(["set", SECRET_ACCOUNTS.braveApiKey], "short");
    assert.equal(code, 1);
    assert.match(cli.output(), /too short/);
  });
});
