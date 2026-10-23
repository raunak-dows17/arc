import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SandboxViolationError } from "../../domain/errors/agent.errors.js";
import {
  assertPortableRelativePath,
  pathComparisonKey,
} from "../../domain/services/portable-path.js";

describe("assertPortableRelativePath", () => {
  it("allows ordinary relative paths", () => {
    assert.doesNotThrow(() => assertPortableRelativePath("notes/plan.md"));
    assert.doesNotThrow(() => assertPortableRelativePath("src\\index.ts"));
    assert.doesNotThrow(() => assertPortableRelativePath("."));
  });

  it("rejects drive, UNC, and device paths", () => {
    for (const value of [
      "C:\\Users\\Raunak Pandey\\Projects\\arc",
      "C:/Users/Raunak/Projects",
      "\\\\server\\share\\file.txt",
      "//server/share/file.txt",
      "\\\\?\\C:\\secret.txt",
    ]) {
      assert.throws(
        () => assertPortableRelativePath(value),
        SandboxViolationError,
        value,
      );
    }
  });

  it("rejects alternate data streams, reserved names, and ambiguous endings", () => {
    for (const value of [
      "notes.txt:secret",
      "CON",
      "con.txt",
      "nested/NUL",
      "trailing.",
      "trailing ",
      "bad?.txt",
    ]) {
      assert.throws(
        () => assertPortableRelativePath(value),
        SandboxViolationError,
        value,
      );
    }
  });
});

describe("pathComparisonKey", () => {
  it("lowercases only for Windows comparison", () => {
    assert.equal(
      pathComparisonKey("C:\\Users\\Raunak\\Projects", "win32"),
      "c:\\users\\raunak\\projects",
    );
    assert.equal(
      pathComparisonKey("/Users/Raunak/Projects", "darwin"),
      "/Users/Raunak/Projects",
    );
  });
});
