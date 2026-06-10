import fsSync from "node:fs";
import path from "node:path";
import { config } from "@/src/config";
import { encryptJson, decryptJson } from "@/src/security/crypto";

export function readStore() {
  const storePath = config.tokenStorePath;
  if (!fsSync.existsSync(storePath)) return { users: {} };
  try {
    const data = fsSync.readFileSync(storePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Failed to read token store:", err);
    return { users: {} };
  }
}

export function writeStore(store: any) {
  const storePath = config.tokenStorePath;
  fsSync.mkdirSync(path.dirname(storePath), { recursive: true });
  fsSync.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

export function loadUserTokens(tokenStoreKey: string) {
  if (!tokenStoreKey) return null;
  const store = readStore();
  const encrypted = store.users?.[tokenStoreKey]?.token;
  if (!encrypted) return null;
  return decryptJson(encrypted);
}

export function saveUserTokens(tokenStoreKey: string, tokens: any) {
  if (!tokenStoreKey) return;
  const store = readStore();
  if (!store.users) store.users = {};
  if (!store.users[tokenStoreKey]) store.users[tokenStoreKey] = {};
  store.users[tokenStoreKey].token = encryptJson(tokens);
  writeStore(store);
}

export function deleteUserTokens(tokenStoreKey: string) {
  if (!tokenStoreKey) return;
  const store = readStore();
  if (store.users && store.users[tokenStoreKey]) {
    delete store.users[tokenStoreKey];
    writeStore(store);
  }
}
