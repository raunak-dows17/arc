import type { SecretStorePort } from "../../domain/ports/secret-store.port.js";
import {
  KNOWN_SECRET_ACCOUNTS,
  SECRET_ACCOUNT_HELP,
} from "../../shared/secret-accounts.js";
import { errorMessage } from "../../shared/text.js";

export interface SecretsCliIO {
  output: (text: string) => void;
  readSecret: (label: string) => Promise<string>;
}

/**
 * `arc secrets` never accepts a secret as a command-line argument (where it
 * would land in shell history). It reads from a hidden terminal prompt, or
 * from stdin when piped.
 */
export async function runSecretsCommand(
  store: SecretStorePort,
  args: readonly string[],
  io: Partial<SecretsCliIO> = {},
): Promise<number> {
  const output = io.output ?? ((text: string) => process.stdout.write(text));
  const readSecret = io.readSecret ?? readSecretFromInput;
  const [command, account, ...rest] = args;

  if (!command || command === "help" || command === "--help") {
    printUsage(output);
    return 0;
  }

  if (command === "list") {
    await listSecrets(store, output);
    return 0;
  }

  if (command !== "set" && command !== "delete" && command !== "check") {
    output(`Unknown secrets command "${command}".\n\n`);
    printUsage(output);
    return 1;
  }

  if (!account) {
    output(`Usage: arc secrets ${command} <account>\n`);
    return 1;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(account)) {
    output(`Invalid account name "${account}".\n`);
    return 1;
  }
  if (
    !(KNOWN_SECRET_ACCOUNTS as readonly string[]).includes(account) &&
    !/^provider\.[A-Za-z0-9._-]+\.api-key$/.test(account)
  ) {
    output(
      `Unknown account "${account}". Known accounts:\n${KNOWN_SECRET_ACCOUNTS.map((name) => `  ${name}`).join("\n")}\n`,
    );
    return 1;
  }

  if (command === "check") {
    const value = await store.get(account);
    output(`${account}: ${value ? "set" : "missing"}\n`);
    return 0;
  }

  if (command === "delete") {
    const deleted = await store.delete(account);
    output(
      deleted
        ? `Deleted ${account} from the OS credential store.\n`
        : `${account} was not present in the OS credential store.\n`,
    );
    return 0;
  }

  if (rest.length > 0) {
    output(
      "Do not pass secrets as arguments. Run `arc secrets set <account>` and enter the value at the hidden prompt, or pipe it on stdin.\n",
    );
    return 1;
  }

  let secret: string;
  try {
    secret = (await readSecret(`Secret for ${account}: `)).trim();
  } catch (error) {
    output(`Could not read the secret: ${errorMessage(error)}\n`);
    return 1;
  }
  if (secret.length < 8) {
    output("The secret is empty or too short; nothing was stored.\n");
    return 1;
  }

  try {
    await store.set(account, secret);
  } catch (error) {
    output(`Could not store ${account}: ${errorMessage(error)}\n`);
    return 1;
  }
  output(`Stored ${account} in the OS credential store.\n`);
  return 0;
}

async function listSecrets(
  store: SecretStorePort,
  output: (text: string) => void,
): Promise<void> {
  output("ARC secrets (values are never displayed):\n");
  for (const account of KNOWN_SECRET_ACCOUNTS) {
    let status = "error";
    try {
      status = (await store.get(account)) ? "set" : "missing";
    } catch {
      status = "unavailable";
    }
    const help = SECRET_ACCOUNT_HELP[account] ?? "";
    output(
      `  [${status.padEnd(11)}] ${account}${help ? ` — ${help}` : ""}\n`,
    );
  }
  output(
    "Set with: arc secrets set <account>\nDelete with: arc secrets delete <account>\n",
  );
}

function printUsage(output: (text: string) => void): void {
  output(
    [
      "Usage:",
      "  arc secrets list",
      "  arc secrets set <account>        (hidden prompt)",
      "  arc secrets check <account>",
      "  arc secrets delete <account>",
      "",
      "Known accounts:",
      ...KNOWN_SECRET_ACCOUNTS.map((account) => `  ${account}`),
      "",
      "Secrets are stored in the OS credential store: Windows Credential Manager,",
      "macOS Keychain, or Linux Secret Service. Never pass a secret as an",
      "argument; it would be recorded in shell history.",
      "",
    ].join("\n"),
  );
}

export async function readSecretFromInput(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return readPipedSecret();
  }

  const stdin = process.stdin;
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const previousRaw = stdin.isRaw;

    const cleanup = (): void => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(previousRaw);
      }
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character === "\u001b") {
          continue;
        }
        value += character;
        process.stdout.write("*");
      }
    };

    try {
      stdin.setRawMode(true);
    } catch (error) {
      reject(error);
      return;
    }
    stdin.setEncoding("utf8");
    stdin.resume();
    process.stdout.write(label);
    stdin.on("data", onData);
  });
}

async function readPipedSecret(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
