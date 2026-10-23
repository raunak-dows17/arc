import { AsyncEntry } from "@napi-rs/keyring";
import type {
  SecretStoreHealth,
  SecretStorePort,
} from "../../domain/ports/secret-store.port.js";

interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

type EntryFactory = (service: string, account: string) => KeyringEntry;

const DEFAULT_SERVICE = "ARC";

/**
 * Cross-platform OS credential storage: Windows Credential Manager on the
 * production laptop, macOS Keychain during development.
 */
export class NapiKeyringSecretStore implements SecretStorePort {
  constructor(
    private readonly service = DEFAULT_SERVICE,
    private readonly createEntry: EntryFactory = (serviceName, account) =>
      new AsyncEntry(serviceName, account),
  ) {}

  async get(account: string): Promise<string | null> {
    return this.entry(account).getPassword();
  }

  async set(account: string, secret: string): Promise<void> {
    await this.entry(account).setPassword(secret);
  }

  async delete(account: string): Promise<boolean> {
    return this.entry(account).deletePassword();
  }

  async healthCheck(): Promise<SecretStoreHealth> {
    const probe = `health.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const value = "arc-keyring-probe";
    try {
      const entry = this.entry(probe);
      await entry.setPassword(value);
      const readBack = await entry.getPassword();
      await entry.deletePassword();
      if (readBack !== value) {
        return {
          ok: false,
          message: "Credential store read-back did not match the probe value.",
        };
      }
      return {
        ok: true,
        message: `OS keyring is available (${keyringLabel()}) for service "${this.service}".`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Could not access the OS credential store: ${errorMessage(error)}`,
      };
    }
  }

  private entry(account: string): KeyringEntry {
    return this.createEntry(this.service, account);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyringLabel(): string {
  if (process.platform === "win32") {
    return "Windows Credential Manager";
  }
  if (process.platform === "darwin") {
    return "macOS Keychain";
  }
  return "OS credential store";
}
