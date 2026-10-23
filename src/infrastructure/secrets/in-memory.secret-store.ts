import type {
  SecretStoreHealth,
  SecretStorePort,
} from "../../domain/ports/secret-store.port.js";

/** Test/dev-only secret store. Never use this for production credentials. */
export class InMemorySecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();

  async get(account: string): Promise<string | null> {
    return this.values.get(account) ?? null;
  }

  async set(account: string, secret: string): Promise<void> {
    this.values.set(account, secret);
  }

  async delete(account: string): Promise<boolean> {
    return this.values.delete(account);
  }

  async healthCheck(): Promise<SecretStoreHealth> {
    return { ok: true, message: "In-memory secret store is available." };
  }
}
