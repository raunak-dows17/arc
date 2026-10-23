import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { JsonEmailStateStore } from "./json-email-state.store.js";

describe("JsonEmailStateStore", () => {
  let base: string;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "arc-email-state-"));
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("returns null before the first save and round-trips state", async () => {
    const store = new JsonEmailStateStore(path.join(base, "state.json"));
    assert.equal(await store.load(), null);

    await store.save({
      uidValidity: "42",
      lastNotifiedUid: 7,
      updatedAt: "2026-10-23T12:00:00.000Z",
    });

    assert.deepEqual(await store.load(), {
      uidValidity: "42",
      lastNotifiedUid: 7,
      updatedAt: "2026-10-23T12:00:00.000Z",
    });
  });

  it("rejects corrupt state instead of silently resetting the cursor", async () => {
    const file = path.join(base, "corrupt.json");
    await writeFile(file, "{not-json", "utf8");
    const store = new JsonEmailStateStore(file);
    await assert.rejects(store.load(), /invalid/i);
  });
});
