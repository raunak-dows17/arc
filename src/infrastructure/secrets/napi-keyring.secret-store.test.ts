import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NapiKeyringSecretStore } from "./napi-keyring.secret-store.js";

describe("NapiKeyringSecretStore", () => {
  it("stores, reads, and deletes through the injected keyring", async () => {
    const values = new Map<string, string>();
    const store = new NapiKeyringSecretStore("ARC", (_service, account) => ({
      async getPassword() {
        return values.get(account) ?? null;
      },
      async setPassword(password) {
        values.set(account, password);
      },
      async deletePassword() {
        return values.delete(account);
      },
    }));

    assert.equal(await store.get("telegram.bot-token"), null);
    await store.set("telegram.bot-token", "secret");
    assert.equal(await store.get("telegram.bot-token"), "secret");
    assert.equal(await store.delete("telegram.bot-token"), true);
    assert.equal(await store.get("telegram.bot-token"), null);
  });

  it("reports a healthy keyring through a probe", async () => {
    const values = new Map<string, string>();
    const store = new NapiKeyringSecretStore("ARC", (_service, account) => ({
      async getPassword() {
        return values.get(account) ?? null;
      },
      async setPassword(password) {
        values.set(account, password);
      },
      async deletePassword() {
        return values.delete(account);
      },
    }));

    const health = await store.healthCheck();

    assert.equal(health.ok, true);
    assert.match(health.message, /keyring/i);
  });
});
