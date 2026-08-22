import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tokenStoreKeyForUid } from "@/src/lib/utils";

// resolveInternalSender reaches Firebase Auth (email -> uid), Firestore
// (credentialRefs), the encrypted-secret decrypt, and the local token store.
// Like payment-proof-route.test.ts we inject fakes into require.cache BEFORE the
// module under test loads, since the repo's test command does not enable
// --experimental-test-module-mocks.
const require = createRequire(import.meta.url);

const CONNECTED_UID = "8oC1Xa6CfjYTizFD112dYtrMlk83";
const UNCONNECTED_UID = "mVZuHIYh9fgKqdNCcEjozziCGk62";

// Which uid (if any) has an active, decryptable credentialRef.
let connectedUid: string | null = CONNECTED_UID;
// Emails Firebase Auth knows about.
let emailToUid: Record<string, string> = {
  "connected@example.com": CONNECTED_UID,
  "unconnected@example.com": UNCONNECTED_UID,
};
let getUserByEmailCalls = 0;

function fakeFirestore() {
  return {
    collection() {
      return {
        where() {
          return this;
        },
        async get() {
          if (!connectedUid) return { docs: [] };
          return {
            docs: [
              { id: "cred-1", data: () => ({ userId: connectedUid, secret: "enc-blob", status: "active" }) },
            ],
          };
        },
      };
    },
  };
}

function injectMock(specifier: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
}

function installMocks() {
  injectMock("@/src/firebase/admin", {
    getFirestoreDb: () => fakeFirestore(),
    getFirebaseAdminAuth: () => ({
      async getUserByEmail(email: string) {
        getUserByEmailCalls += 1;
        const uid = emailToUid[email];
        if (!uid) {
          const err = new Error("no user") as Error & { code: string };
          err.code = "auth/user-not-found";
          throw err;
        }
        return { uid };
      },
    }),
  });
  // Only the connected uid's blob decrypts to a token; anything else is empty.
  injectMock("@/src/security/crypto", {
    decryptCentralSecret: () => ({ access_token: "tok-123" }),
    encryptCentralSecret: () => "enc-blob",
  });
  // Firestore is the source of truth in these tests; local store is always empty.
  injectMock("@/src/domains/local-store", {
    loadUserTokens: () => null,
    saveUserTokens: () => {},
    readStore: () => ({ users: {} }),
  });
}

async function loadModule() {
  return import("@/src/domains/gmail");
}

beforeEach(() => {
  connectedUid = CONNECTED_UID;
  emailToUid = {
    "connected@example.com": CONNECTED_UID,
    "unconnected@example.com": UNCONNECTED_UID,
  };
  getUserByEmailCalls = 0;
  installMocks();
});

afterEach(() => {
  try {
    delete require.cache[require.resolve("@/src/domains/gmail")];
  } catch {
    /* not loaded */
  }
});

test("resolveInternalSender resolves fromEmail to the sender's token-store key", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  const key = await resolveInternalSender({ fromEmail: "connected@example.com" });
  assert.equal(key, tokenStoreKeyForUid(CONNECTED_UID));
  assert.equal(getUserByEmailCalls, 1);
});

test("fromEmail is case-insensitive and trimmed", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  const key = await resolveInternalSender({ fromEmail: "  Connected@Example.com  " });
  assert.equal(key, tokenStoreKeyForUid(CONNECTED_UID));
});

test("fromEmail for a connected-but-tokenless account throws 409", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  connectedUid = null; // no active credentialRef for anyone
  await assert.rejects(
    () => resolveInternalSender({ fromEmail: "unconnected@example.com" }),
    (err: any) => err.status === 409 && /not connected/i.test(err.message),
  );
});

test("fromEmail for an unknown account throws 404", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  await assert.rejects(
    () => resolveInternalSender({ fromEmail: "nobody@example.com" }),
    (err: any) => err.status === 404,
  );
});

test("senderUid takes precedence over fromEmail (no email lookup)", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  const key = await resolveInternalSender({ senderUid: CONNECTED_UID, fromEmail: "connected@example.com" });
  assert.equal(key, tokenStoreKeyForUid(CONNECTED_UID));
  assert.equal(getUserByEmailCalls, 0);
});

test("no identity fields throws 400 mentioning fromEmail", async () => {
  const { resolveInternalSender } = (await loadModule()) as any;
  await assert.rejects(
    () => resolveInternalSender({}),
    (err: any) => err.status === 400 && /fromEmail/.test(err.message),
  );
});
