const DB_NAME = "fiber-route-doctor";
const DB_VERSION = 1;
const STORES = ["keystore", "profiles"] as const;

export function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * request.onsuccess fires BEFORE the surrounding transaction commits. For reads that's
 * harmless (nothing to lose), but for writes it means a save() could resolve and then the
 * commit still aborts (quota/eviction), leaving the caller believing it persisted when it
 * didn't. So: readonly resolves on request success; readwrite resolves on transaction
 * completion (with the value captured from the request), and rejects on transaction
 * error/abort so a failed commit surfaces as a rejected promise.
 */
function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openStore().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onerror = () => { db.close(); reject(request.error); };

    if (mode === "readonly") {
      request.onsuccess = () => { db.close(); resolve(request.result as T); };
      return;
    }

    let result: T;
    request.onsuccess = () => { result = request.result as T; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  }));
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, "readonly", (s) => s.get(key));
}
export function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return tx<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)).then(() => undefined);
}
export function idbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll());
}
export function idbDelete(store: string, key: string): Promise<void> {
  return tx<undefined>(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}
