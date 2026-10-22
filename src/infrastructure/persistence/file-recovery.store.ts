import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

interface FileRecoveryTransaction {
  actionId: string;
  filename: string;
  state: "prepared" | "applied" | "rolled_back";
  beforeExists: boolean;
  beforeContent?: string;
  beforeHash?: string;
  afterHash: string;
}

export interface FileWriteResult {
  actionId: string;
  filename: string;
}

export class FileRecoveryStore {
  private readonly sandboxDir: string;
  private readonly recoveryDir: string;

  constructor(sandboxDir = path.resolve(process.cwd(), "agent_sandbox")) {
    this.sandboxDir = sandboxDir;
    this.recoveryDir = path.join(this.sandboxDir, ".agent_recovery");
  }

  public async writeAndVerify(
    filename: unknown,
    content: unknown,
  ): Promise<FileWriteResult> {
    const safeFilename = this.normalizeFilename(filename);
    if (typeof content !== "string") {
      throw new Error("File content must be a string.");
    }

    await fs.promises.mkdir(this.sandboxDir, { recursive: true });
    const targetPath = path.join(this.sandboxDir, safeFilename);
    const existingStat = await this.statIfExists(targetPath);
    if (existingStat?.isSymbolicLink()) {
      throw new Error("Refusing to write through a symbolic link.");
    }
    if (existingStat && !existingStat.isFile()) {
      throw new Error("The target exists and is not a regular file.");
    }

    const beforeExists = existingStat !== undefined;
    const beforeContent = beforeExists
      ? await fs.promises.readFile(targetPath, "utf8")
      : undefined;
    const actionId = randomUUID();
    const transaction: FileRecoveryTransaction = {
      actionId,
      filename: safeFilename,
      state: "prepared",
      beforeExists,
      ...(beforeContent !== undefined ? { beforeContent } : {}),
      ...(beforeContent !== undefined
        ? { beforeHash: this.hash(beforeContent) }
        : {}),
      afterHash: this.hash(content),
    };

    await this.saveTransaction(transaction);

    const temporaryPath = path.join(
      this.sandboxDir,
      `.${safeFilename}.${actionId}.tmp`,
    );
    try {
      await fs.promises.writeFile(temporaryPath, content, {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.promises.rename(temporaryPath, targetPath);

      const writtenContent = await fs.promises.readFile(targetPath, "utf8");
      if (writtenContent !== content) {
        throw new Error("Written file contents did not match the requested content.");
      }

      transaction.state = "applied";
      await this.saveTransaction(transaction);
      return { actionId, filename: safeFilename };
    } catch (error: unknown) {
      await fs.promises.rm(temporaryPath, { force: true });
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `File write or verification failed. Recovery action ID: ${actionId}. ${cause}`,
        { cause: error },
      );
    }
  }

  public async rollback(actionId: unknown): Promise<FileWriteResult> {
    if (typeof actionId !== "string" || !this.isActionId(actionId)) {
      throw new Error("A valid recovery action ID is required.");
    }

    const transaction = await this.loadTransaction(actionId);
    if (!transaction) {
      throw new Error(`Recovery action [${actionId}] was not found.`);
    }
    if (transaction.state === "rolled_back") {
      return { actionId, filename: transaction.filename };
    }

    const targetPath = path.join(this.sandboxDir, transaction.filename);
    const currentStat = await this.statIfExists(targetPath);
    if (currentStat?.isSymbolicLink()) {
      throw new Error("Refusing to restore through a symbolic link.");
    }
    if (currentStat && !currentStat.isFile()) {
      throw new Error("The restore target is not a regular file.");
    }

    const currentContent = currentStat
      ? await fs.promises.readFile(targetPath, "utf8")
      : undefined;
    const currentHash =
      currentContent === undefined ? undefined : this.hash(currentContent);
    const isCurrentWrite =
      currentHash !== undefined && currentHash === transaction.afterHash;
    const isOriginalState = transaction.beforeExists
      ? currentHash === transaction.beforeHash
      : currentContent === undefined;

    if (isOriginalState && !isCurrentWrite) {
      transaction.state = "rolled_back";
      await this.saveTransaction(transaction);
      return { actionId, filename: transaction.filename };
    }
    if (!isCurrentWrite) {
      throw new Error(
        "Rollback refused because the file changed after the recorded write. The newer contents were left untouched.",
      );
    }

    if (transaction.beforeExists) {
      const beforeContent = transaction.beforeContent;
      if (beforeContent === undefined) {
        throw new Error("The recovery journal is missing the original contents.");
      }
      await this.replaceAtomically(targetPath, beforeContent, actionId);
      const restoredContent = await fs.promises.readFile(targetPath, "utf8");
      if (restoredContent !== beforeContent) {
        throw new Error("Restored contents failed verification.");
      }
    } else {
      await fs.promises.unlink(targetPath);
      if ((await this.statIfExists(targetPath)) !== undefined) {
        throw new Error("The newly created file still exists after rollback.");
      }
    }

    transaction.state = "rolled_back";
    await this.saveTransaction(transaction);
    return { actionId, filename: transaction.filename };
  }

  private normalizeFilename(filename: unknown): string {
    if (
      typeof filename !== "string" ||
      filename.trim() === "" ||
      filename === "." ||
      filename === ".."
    ) {
      throw new Error("A non-empty filename is required.");
    }

    if (filename.includes("/") || filename.includes("\\")) {
      throw new Error("The filename must be a single sandbox file name.");
    }
    const safeFilename = path.basename(filename);
    if (safeFilename.startsWith(".") && safeFilename !== ".") {
      throw new Error("Hidden filenames are reserved for agent recovery data.");
    }
    return safeFilename;
  }

  private async replaceAtomically(
    targetPath: string,
    content: string,
    actionId: string,
  ): Promise<void> {
    const temporaryPath = path.join(
      this.sandboxDir,
      `.${path.basename(targetPath)}.${actionId}.restore.tmp`,
    );
    try {
      await fs.promises.writeFile(temporaryPath, content, {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.promises.rename(temporaryPath, targetPath);
    } catch (error: unknown) {
      await fs.promises.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async saveTransaction(
    transaction: FileRecoveryTransaction,
  ): Promise<void> {
    await fs.promises.mkdir(this.recoveryDir, { recursive: true });
    const targetPath = path.join(
      this.recoveryDir,
      `${transaction.actionId}.json`,
    );
    const temporaryPath = `${targetPath}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      JSON.stringify(transaction),
      { encoding: "utf8", flag: "w" },
    );
    await fs.promises.rename(temporaryPath, targetPath);
  }

  private async loadTransaction(
    actionId: string,
  ): Promise<FileRecoveryTransaction | undefined> {
    const targetPath = path.join(this.recoveryDir, `${actionId}.json`);
    try {
      const raw = await fs.promises.readFile(targetPath, "utf8");
      const value: unknown = JSON.parse(raw);
      if (
        typeof value !== "object" ||
        value === null ||
        !("actionId" in value) ||
        !("filename" in value) ||
        !("state" in value) ||
        !("beforeExists" in value) ||
        !("afterHash" in value)
      ) {
        throw new Error(`Recovery journal [${actionId}] is invalid.`);
      }
      const transaction = value as FileRecoveryTransaction;
      if (
        transaction.actionId !== actionId ||
        !this.isActionId(transaction.actionId) ||
        typeof transaction.filename !== "string" ||
        path.basename(transaction.filename) !== transaction.filename ||
        typeof transaction.beforeExists !== "boolean" ||
        typeof transaction.afterHash !== "string" ||
        !["prepared", "applied", "rolled_back"].includes(transaction.state) ||
        (transaction.beforeExists &&
          typeof transaction.beforeContent !== "string")
      ) {
        throw new Error(`Recovery journal [${actionId}] is invalid.`);
      }
      return transaction;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async statIfExists(
    filePath: string,
  ): Promise<Awaited<ReturnType<typeof fs.promises.lstat>> | undefined> {
    try {
      return await fs.promises.lstat(filePath);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private hash(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  private isActionId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
