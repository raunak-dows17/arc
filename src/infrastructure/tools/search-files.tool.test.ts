import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NodeFsSandboxAdapter } from "../sandbox/node-fs-sandbox.adapter.js";
import { SearchFilesTool } from "./search-files.tool.js";

describe("SearchFilesTool", () => {
  let base: string;
  let sandbox: NodeFsSandboxAdapter;
  let tool: SearchFilesTool;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "arc-search-"));
    sandbox = await NodeFsSandboxAdapter.create(path.join(base, "workspace"));
    tool = new SearchFilesTool(sandbox);
    await sandbox.write("src/app.ts", "const Companion = 'ARC';\nexport default Companion;\n");
    await sandbox.write("src/notes.md", "arc is local-first\nARC is careful\n");
    await sandbox.write("node_modules/pkg/index.js", "const Companion = 'ignored';\n");
    await sandbox.write("dist/out.js", "const Companion = 'ignored';\n");
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("finds literal matches with path and line numbers", async () => {
    const result = await tool.execute({ query: "Companion" });

    assert.match(result, /Found 2 match\(es\)/);
    assert.match(result, /src\/app\.ts:1:/);
    assert.match(result, /src\/app\.ts:2:/);
    assert.doesNotMatch(result, /node_modules/);
    assert.doesNotMatch(result, /dist\/out/);
  });

  it("is case-insensitive by default and supports case-sensitive search", async () => {
    const insensitive = await tool.execute({ query: "arc" });
    assert.match(insensitive, /src\/notes\.md:1:/);
    assert.match(insensitive, /src\/notes\.md:2:/);

    const sensitive = await tool.execute({
      query: "ARC",
      case_sensitive: true,
    });
    assert.match(sensitive, /src\/notes\.md:2:/);
    assert.doesNotMatch(sensitive, /src\/notes\.md:1:/);
  });

  it("honours the result cap and reports no matches", async () => {
    const limited = await tool.execute({ query: "Companion", max_results: 1 });
    assert.match(limited, /Found 1 match\(es\)/);
    assert.match(limited, /limit/);

    const none = await tool.execute({ query: "not-present" });
    assert.match(none, /No matches/);
  });
});
