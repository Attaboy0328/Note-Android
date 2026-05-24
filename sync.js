import {
  getAllCategories,
  getAllEntries,
  getMeta,
  mergeRemoteData,
  putCategory,
  putEntry,
  setMeta
} from "./db.js";

const SYNC_CONFIG_KEY = "note-sync-config-v1";

let supabaseClient = null;
let syncConfig = loadSyncConfig();

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    return raw ? JSON.parse(raw) : { url: "", anonKey: "" };
  } catch {
    return { url: "", anonKey: "" };
  }
}

export function getSyncConfig() {
  return { ...syncConfig };
}

export function saveSyncConfig(next) {
  syncConfig = {
    url: String(next.url || "").trim(),
    anonKey: String(next.anonKey || "").trim()
  };
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncConfig));
  supabaseClient = null;
  return syncConfig;
}

export function isSyncConfigured() {
  return Boolean(syncConfig.url && syncConfig.anonKey);
}

async function ensureClient() {
  if (!isSyncConfigured()) return null;
  if (supabaseClient) return supabaseClient;
  const sdk = window.supabase;
  if (!sdk?.createClient) throw new Error("Supabase SDK 未加载");
  supabaseClient = sdk.createClient(syncConfig.url, syncConfig.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return supabaseClient;
}

export async function ensureSession() {
  const client = await ensureClient();
  if (!client) return null;
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) return sessionData.session;
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function pullRemote() {
  if (!isSyncConfigured()) return { ok: false, reason: "not_configured" };

  const session = await ensureSession();
  if (!session?.user?.id) return { ok: false, reason: "no_session" };

  const client = await ensureClient();
  const userId = session.user.id;

  const [{ data: categories, error: catError }, { data: entries, error: entryError }] = await Promise.all([
    client.from("note_categories").select("*").eq("user_id", userId).order("sort_order"),
    client.from("note_entries").select("*").eq("user_id", userId)
  ]);

  if (catError) throw catError;
  if (entryError) throw entryError;

  const remoteCategories = categories || [];
  const remoteEntries = entries || [];

  if (remoteCategories.length === 0 && remoteEntries.length === 0) {
    const localCategories = await getAllCategories();
    const localEntries = await getAllEntries(true);
    for (const category of localCategories) {
      await pushCategory(category, userId);
    }
    for (const entry of localEntries) {
      await pushEntry(entry, userId);
    }
  } else {
    await mergeRemoteData({ categories: remoteCategories, entries: remoteEntries });
  }

  await setMeta("lastPullAt", new Date().toISOString());
  return { ok: true, categories: remoteCategories.length, entries: remoteEntries.length };
}

export async function pushCategory(category, userId) {
  const client = await ensureClient();
  if (!client) return false;
  const uid = userId || (await ensureSession())?.user?.id;
  if (!uid) return false;

  const row = {
    id: category.id,
    user_id: uid,
    name: category.name,
    sort_order: category.sort_order,
    created_at: category.created_at,
    updated_at: category.updated_at || new Date().toISOString()
  };

  const { error } = await client.from("note_categories").upsert(row, { onConflict: "id" });
  if (error) throw error;
  return true;
}

export async function deleteCategoryRemote(categoryId, userId) {
  const client = await ensureClient();
  if (!client) return false;
  const uid = userId || (await ensureSession())?.user?.id;
  if (!uid) return false;

  const { error } = await client.from("note_categories").delete().eq("id", categoryId).eq("user_id", uid);
  if (error) throw error;
  return true;
}

export async function pushEntry(entry, userId) {
  const client = await ensureClient();
  if (!client) return false;
  const uid = userId || (await ensureSession())?.user?.id;
  if (!uid) return false;

  const row = {
    id: entry.id,
    user_id: uid,
    category_id: entry.category_id || null,
    title: entry.title || "",
    body: entry.body || "",
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    deleted_at: entry.deleted_at || null
  };

  const { error } = await client.from("note_entries").upsert(row, { onConflict: "id" });
  if (error) throw error;
  return true;
}

export async function syncAllPending() {
  if (!isSyncConfigured()) return { ok: false, reason: "not_configured" };

  const session = await ensureSession();
  if (!session?.user?.id) return { ok: false, reason: "no_session" };

  const userId = session.user.id;
  const categories = await getAllCategories();
  const entries = await getAllEntries(true);

  for (const category of categories) {
    await pushCategory(category, userId);
  }
  for (const entry of entries) {
    await pushEntry(entry, userId);
  }

  await setMeta("lastPushAt", new Date().toISOString());
  return { ok: true, categories: categories.length, entries: entries.length };
}

export async function fullSync() {
  await pullRemote();
  return syncAllPending();
}

export async function getLastSyncMeta() {
  const [lastPullAt, lastPushAt] = await Promise.all([getMeta("lastPullAt"), getMeta("lastPushAt")]);
  return {
    lastPullAt: lastPullAt?.value || null,
    lastPushAt: lastPushAt?.value || null
  };
}
