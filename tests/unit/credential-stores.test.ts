import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileCredentialStore } from "../../src/infrastructure/credentials/file-credential-store.js";
import {
  KeyringCredentialStore,
  type KeyringEntry
} from "../../src/infrastructure/credentials/keyring-credential-store.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-creds-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("FileCredentialStore", () => {
  it("stores, reads and deletes per provider", async () => {
    const store = new FileCredentialStore(dir);
    expect(await store.get("gemini")).toBeUndefined();
    await store.set("gemini", "key-one-12345");
    await store.set("other", "key-two-12345");
    expect(await store.get("gemini")).toBe("key-one-12345");
    await store.delete("gemini");
    expect(await store.get("gemini")).toBeUndefined();
    expect(await store.get("other")).toBe("key-two-12345");
    await store.delete("never-existed");
  });

  it.skipIf(process.platform === "win32")("creates the file with owner-only permissions", async () => {
    const store = new FileCredentialStore(path.join(dir, "nested"));
    await store.set("gemini", "key-one-12345");
    expect(fs.statSync(store.location).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(store.location)).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("tightens permissions when rewriting a loose file", async () => {
    const store = new FileCredentialStore(dir);
    fs.writeFileSync(store.location, "{}", { mode: 0o644 });
    await store.set("gemini", "key-one-12345");
    expect(fs.statSync(store.location).mode & 0o777).toBe(0o600);
  });

  it("leaves no temporary files behind", async () => {
    const store = new FileCredentialStore(dir);
    await store.set("gemini", "key-one-12345");
    expect(fs.readdirSync(dir)).toEqual(["credentials.json"]);
  });

  it("reports a corrupted file without echoing its contents", async () => {
    const store = new FileCredentialStore(dir);
    fs.writeFileSync(store.location, "{not json secret-material");
    await expect(store.get("gemini")).rejects.toSatisfy((error: Error) => !error.message.includes("secret-material"));
    await expect(store.get("gemini")).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
  });
});

function fakeEntry(state: { value: string | null }): KeyringEntry {
  return {
    getPassword: async () => state.value,
    setPassword: async (password) => void (state.value = password),
    deletePassword: async () => {
      const existed = state.value !== null;
      state.value = null;
      return existed;
    }
  };
}

describe("KeyringCredentialStore", () => {
  it("uses the expressforge service and the provider id as the account", async () => {
    const state = { value: null as string | null };
    const seen: string[][] = [];
    const store = new KeyringCredentialStore(async (service, account) => {
      seen.push([service, account]);
      return fakeEntry(state);
    });
    await store.set("gemini", "key-one-12345");
    expect(await store.get("gemini")).toBe("key-one-12345");
    await store.delete("gemini");
    expect(await store.get("gemini")).toBeUndefined();
    expect(seen[0]).toEqual(["expressforge", "gemini"]);
  });

  it("turns native failures into CREDENTIAL_STORE_UNAVAILABLE without leaking the cause message", async () => {
    const store = new KeyringCredentialStore(async () => {
      throw new Error("dbus exploded with key-should-not-show");
    });
    for (const operation of [
      () => store.get("gemini"),
      () => store.set("gemini", "x12345678"),
      () => store.delete("gemini")
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: "CREDENTIAL_STORE_UNAVAILABLE",
        message: expect.not.stringContaining("key-should-not-show")
      });
    }
  });

  it("explains how to recover", async () => {
    const store = new KeyringCredentialStore(async () => {
      throw new Error("no backend");
    });
    await expect(store.get("gemini")).rejects.toMatchObject({ hint: expect.stringContaining("GEMINI_API_KEY") });
  });
});
