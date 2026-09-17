import { validateWorkspace } from "../../../packages/core/workspace.mjs";
export const CONFIRMED_TTL = 24 * 60 * 60 * 1000;
export type Confirmed = {
  version: number;
  value: ReturnType<typeof validateWorkspace>;
  saved: number;
};
export function confirmedSnapshot(input: unknown, now = Date.now()): Confirmed | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.version) ||
    Number(record.version) < 1 ||
    record.pending === true ||
    !Number.isFinite(record.saved)
  )
    return null;
  const age = now - Number(record.saved);
  if (age < 0 || age > CONFIRMED_TTL) return null;
  try {
    return {
      version: Number(record.version),
      value: validateWorkspace(record.value),
      saved: Number(record.saved),
    };
  } catch {
    return null;
  }
}
export function shouldReplaceConfirmed(
  existing: unknown,
  incoming: unknown,
  now = Date.now(),
): boolean {
  const next = confirmedSnapshot(incoming, now);
  if (!next) return false;
  const before = confirmedSnapshot(existing, now);
  return !before || next.version >= before.version;
}
export type CacheRecord = {
  version: number;
  saved: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  invalidatedAt?: number;
};
const DB = "boards-confirmed-cache-v1",
  STORE = "snapshots";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DB, 2);
    const timer = setTimeout(() => {
      settled = true;
      reject(Error("Cache unavailable"));
    }, 200);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : request.result.createObjectStore(STORE);
      if (!store.indexNames.contains("saved")) store.createIndex("saved", "saved");
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => db.close();
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(request.error);
      }
    };
  });
}
function prune(store: IDBObjectStore, now: number) {
  if (!store.indexNames.contains("saved")) return;
  const count = store.count();
  count.onsuccess = () => {
    let remaining = count.result;
    const cursor = store.index("saved").openKeyCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      if (Number(row.key) < now - CONFIRMED_TTL || remaining > 24) {
        store.delete(row.primaryKey);
        remaining--;
        row.continue();
      }
    };
  };
}
/** Only encrypted, acknowledged data. No editor key, auth token, draft or public share is stored. */
export function confirmedCache(scope: string, capability: string) {
  if (!/^boards:tab:[a-f0-9]{64}$/.test(scope) || !/^[A-Za-z0-9_-]{43}$/.test(capability))
    throw Error("Invalid cache scope");
  const encryption = crypto.subtle
    .digest("SHA-256", new TextEncoder().encode("boards-confirmed-encryption-v1\0" + capability))
    .then((key) => crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]));
  const aad = (version: number, saved: number) =>
    new TextEncoder().encode(JSON.stringify([scope, version, saved]));
  async function read(): Promise<Confirmed | null> {
    const db = await database();
    let record: CacheRecord | undefined;
    try {
      record = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(scope);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
    if (
      !record ||
      record.version < 1 ||
      record.invalidatedAt ||
      Date.now() - record.saved > CONFIRMED_TTL ||
      record.saved > Date.now()
    )
      return null;
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: record.iv as Uint8Array<ArrayBuffer>,
          additionalData: aad(record.version, record.saved),
        },
        await encryption,
        record.ciphertext,
      );
      return confirmedSnapshot({
        version: record.version,
        saved: record.saved,
        value: JSON.parse(new TextDecoder().decode(decrypted)),
      });
    } catch {
      return null;
    }
  }
  async function write(version: number, value: unknown, requestStarted: number): Promise<boolean> {
    const snapshot = confirmedSnapshot({
      version,
      value: structuredClone(value),
      saved: Date.now(),
    });
    if (!snapshot) return false;
    const encoded = new TextEncoder().encode(JSON.stringify(snapshot.value));
    if (encoded.length > 800000) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(version, snapshot.saved) },
        await encryption,
        encoded,
      );
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"),
          store = tx.objectStore(STORE),
          get = store.get(scope);
        let written = false;
        get.onsuccess = () => {
          const old = get.result as CacheRecord | undefined;
          if (old && (old.version > version || (old.invalidatedAt || 0) >= requestStarted)) return;
          store.put({ version, saved: snapshot.saved, iv, ciphertext }, scope);
          written = true;
          prune(store, Date.now());
        };
        tx.oncomplete = () => resolve(written);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async function invalidate(): Promise<void> {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(
          { version: 0, saved: Date.now(), invalidatedAt: Date.now() },
          scope,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  return { read, write, invalidate };
}
