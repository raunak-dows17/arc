export interface SecretStoreHealth {
  ok: boolean;
  message: string;
}

/**
 * OS-backed secret storage. Account names are stable identifiers such as
 * "telegram.bot-token"; implementations must never write secrets to the
 * workspace or audit log.
 */
export interface SecretStorePort {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<boolean>;
  healthCheck(): Promise<SecretStoreHealth>;
}
