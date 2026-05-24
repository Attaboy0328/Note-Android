const DB_NAME = "note-pwa";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("categories")) {
          db.createObjectStore("categories", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("entries")) {
          const store = db.createObjectStore("entries", { keyPath: "id" });
          store.createIndex("updated_at", "updated_at");
          store.createIndex("category_id", "category_id");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
    });
  }
  return dbPromise;
}

function tx(storeNames, mode = "readonly") {
  return openDb().then((db) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);
    return { transaction, stores: names.map((name) => transaction.objectStore(name)) };
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getMeta(key) {
  const { stores } = await tx("meta");
  return requestToPromise(stores[0].get(key));
}

export async function setMeta(key, value) {
  const { transaction, stores } = await tx("meta", "readwrite");
  await requestToPromise(stores[0].put({ key, value }));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getAllCategories() {
  const { stores } = await tx("categories");
  const rows = await requestToPromise(stores[0].getAll());
  return rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN"));
}

export async function putCategory(category) {
  const { transaction, stores } = await tx("categories", "readwrite");
  await requestToPromise(stores[0].put(category));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(category);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteCategory(id) {
  const entries = await getAllEntries(true);
  const now = new Date().toISOString();
  const { transaction, stores } = await tx(["categories", "entries"], "readwrite");
  const [catStore, entryStore] = stores;

  await requestToPromise(catStore.delete(id));

  for (const entry of entries) {
    if (entry.category_id !== id) continue;
    entry.category_id = null;
    entry.updated_at = now;
    await requestToPromise(entryStore.put(entry));
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getAllEntries(includeDeleted = false) {
  const { stores } = await tx("entries");
  const rows = await requestToPromise(stores[0].getAll());
  const filtered = includeDeleted ? rows : rows.filter((row) => !row.deleted_at);
  return filtered.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

export async function getEntry(id) {
  const { stores } = await tx("entries");
  return requestToPromise(stores[0].get(id));
}

export async function putEntry(entry) {
  const { transaction, stores } = await tx("entries", "readwrite");
  await requestToPromise(stores[0].put(entry));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(entry);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function restoreEntry(id) {
  const entry = await getEntry(id);
  if (!entry) return null;
  entry.deleted_at = null;
  entry.updated_at = new Date().toISOString();
  return putEntry(entry);
}

export async function deleteEntryPermanent(id) {
  const { transaction, stores } = await tx("entries", "readwrite");
  await requestToPromise(stores[0].delete(id));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function markEntryDeleted(id, deletedAt) {
  const entry = await getEntry(id);
  if (!entry) return null;
  entry.deleted_at = deletedAt || new Date().toISOString();
  entry.updated_at = entry.deleted_at;
  return putEntry(entry);
}

export async function replaceAllFromRemote({ categories, entries }) {
  const { transaction, stores } = await tx(["categories", "entries"], "readwrite");
  const [catStore, entryStore] = stores;
  await requestToPromise(catStore.clear());
  await requestToPromise(entryStore.clear());
  for (const category of categories) {
    await requestToPromise(catStore.put(category));
  }
  for (const entry of entries) {
    await requestToPromise(entryStore.put(entry));
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function mergeRemoteData({ categories, entries }) {
  const localCategories = await getAllCategories();
  const localEntries = await getAllEntries(true);
  const catMap = new Map(localCategories.map((c) => [c.id, c]));
  const entryMap = new Map(localEntries.map((e) => [e.id, e]));

  for (const remote of categories) {
    const local = catMap.get(remote.id);
    if (!local || new Date(remote.updated_at) >= new Date(local.updated_at || 0)) {
      catMap.set(remote.id, remote);
    }
  }

  for (const remote of entries) {
    const local = entryMap.get(remote.id);
    if (!local || new Date(remote.updated_at) >= new Date(local.updated_at || 0)) {
      entryMap.set(remote.id, remote);
    }
  }

  const { transaction, stores } = await tx(["categories", "entries"], "readwrite");
  const [catStore, entryStore] = stores;
  await requestToPromise(catStore.clear());
  await requestToPromise(entryStore.clear());
  for (const category of catMap.values()) {
    await requestToPromise(catStore.put(category));
  }
  for (const entry of entryMap.values()) {
    await requestToPromise(entryStore.put(entry));
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}
