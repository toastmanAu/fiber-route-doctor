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

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openStore().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
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
