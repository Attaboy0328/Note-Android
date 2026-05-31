import {
  deleteCategory,
  deleteEntryPermanent,
  getAllCategories,
  getAllEntries,
  getEntry,
  markEntryDeleted,
  putCategory,
  putEntry,
  restoreEntry
} from "./db.js";
import {
  deleteCategoryRemote,
  ensureSession,
  getLastSyncMeta,
  getSyncConfig,
  initializeSyncConfigFromBackend,
  isSyncConfigured,
  pullRemote,
  pushCategory,
  saveSyncConfig,
  syncAllPending
} from "./sync.js";
import { createEditorController, htmlToPlainText } from "./editor.js?v=16";
import { SKINS, applyAppearance, normalizeSkinId } from "./themes.js";
import { shareAsImage, shareAsLink, shareAsText, shareAsWord } from "./share.js";

const SETTINGS_KEY = "note-settings-v1";
const AUTO_SAVE_MS = 600;
const CATEGORY_FILTER_PREFIX = "category:";
const LIST_FILTERS = [
  { id: "all", name: "鍏ㄩ儴" },
  { id: "trash", name: "鏈€杩戝垹闄? }
];

const ui = {
  screens: document.querySelectorAll(".screen"),
  navItems: document.querySelectorAll(".mobile-nav__item"),
  categoryTabs: document.getElementById("categoryTabs"),
  categoryManageSheet: document.getElementById("categoryManageSheet"),
  categoryManageList: document.getElementById("categoryManageList"),
  categoryNameInput: document.getElementById("categoryNameInput"),
  categoryCreateForm: document.getElementById("categoryCreateForm"),
  manageCategoriesBtn: document.getElementById("manageCategoriesBtn"),
  entryList: document.getElementById("entryList"),
  fabAddBtn: document.getElementById("fabAddBtn"),
  searchToggleBtn: document.getElementById("searchToggleBtn"),
  searchBar: document.getElementById("searchBar"),
  searchInput: document.getElementById("searchInput"),
  searchClearBtn: document.getElementById("searchClearBtn"),
  bottomSearchInput: document.getElementById("bottomSearchInput"),
  bottomAddBtn: document.getElementById("bottomAddBtn"),
  bottomSettingsBtn: document.getElementById("bottomSettingsBtn"),
  settingsBackBtn: document.getElementById("settingsBackBtn"),
  editorSheet: document.getElementById("editorSheet"),
  editorBackBtn: document.getElementById("editorBackBtn"),
  editorShareBtn: document.getElementById("editorShareBtn"),
  editorMoreBtn: document.getElementById("editorMoreBtn"),
  editorDeleteBtn: document.getElementById("editorDeleteBtn"),
  editorBody: document.getElementById("editorBody"),
  editorToolbar: document.getElementById("editorToolbar"),
  editorFindBar: document.getElementById("editorFindBar"),
  editorFindInput: document.getElementById("editorFindInput"),
  editorFindNextBtn: document.getElementById("editorFindNextBtn"),
  editorFindCloseBtn: document.getElementById("editorFindCloseBtn"),
  editorMoreSheet: document.getElementById("editorMoreSheet"),
  editorShareSheet: document.getElementById("editorShareSheet"),
  editorSkinSheet: document.getElementById("editorSkinSheet"),
  editorMoveSheet: document.getElementById("editorMoveSheet"),
  editorMoveList: document.getElementById("editorMoveList"),
  settingsSkinGrid: document.getElementById("settingsSkinGrid"),
  editorSkinGrid: document.getElementById("editorSkinGrid"),
  settingsThemeMode: document.getElementById("settingsThemeMode"),
  editorThemeMode: document.getElementById("editorThemeMode"),
  syncUrlInput: document.getElementById("syncUrlInput"),
  syncKeyInput: document.getElementById("syncKeyInput"),
  saveSyncBtn: document.getElementById("saveSyncBtn"),
  syncNowBtn: document.getElementById("syncNowBtn"),
  syncStatus: document.getElementById("syncStatus"),
  syncToast: document.getElementById("syncToast"),
  moreMenuBtn: document.getElementById("moreMenuBtn"),
  moreMenuPopover: document.getElementById("moreMenuPopover"),
  moreMenuBackdrop: document.getElementById("moreMenuBackdrop")
};

const state = {
  activeScreen: "notes",
  listFilter: "all",
  searchQuery: "",
  categories: [],
  entries: [],
  editorEntryId: null,
  autoSaveTimer: null,
  cloudSyncTimer: null,
  swipe: { activeId: null },
  suppressEditorPopstate: false,
  multiSelect: { active: false, selectedIds: new Set() },
  pinnedCollapsed: false
};

let settings = loadSettings();
let toastTimer = null;
let editorCtrl = null;

function setupEditorToolbarExperience() {
  const toolbar = ui.editorToolbar;
  if (!(toolbar instanceof HTMLElement)) return;
  if (toolbar.dataset.enhanced === "true") return;
  toolbar.dataset.enhanced = "true";

  const groups = Array.from(toolbar.querySelectorAll(".editor-toolbar__group"));
  const separators = Array.from(toolbar.querySelectorAll(".editor-toolbar__sep"));
  if (groups.length <= 3) return;

  groups.forEach((group, index) => {
    if (index >= 3) group.classList.add("is-advanced");
  });
  separators.forEach((sep, index) => {
    if (index >= 2) sep.classList.add("is-advanced");
  });

  toolbar.classList.add("is-compact");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "editor-toolbar__btn editor-toolbar__btn--toggle tap-scale";
  toggleBtn.setAttribute("aria-label", "鏇村鏍煎紡");
  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.dataset.cmd = "toggle-advanced";
  toggleBtn.innerHTML = `<span class="editor-toolbar__toggle-text">鏇村</span>`;
  toolbar.appendChild(toggleBtn);
}

function toggleAdvancedToolbar() {
  const toolbar = ui.editorToolbar;
  if (!(toolbar instanceof HTMLElement)) return;
  const expanded = toolbar.classList.toggle("is-expanded");
  toolbar.classList.toggle("is-compact", !expanded);
  const toggleBtn = toolbar.querySelector(".editor-toolbar__btn--toggle");
  if (toggleBtn instanceof HTMLElement) {
    toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggleBtn.innerHTML = `<span class="editor-toolbar__toggle-text">${expanded ? "鏀惰捣" : "鏇村"}</span>`;
  }
}

function onEditorChange() {
  scheduleAutoSave();
}

function getEditorBody() {
  return editorCtrl?.getHtml?.() ?? "";
}

function resetEditorShell() {
  ui.editorSheet?.classList.add("is-hidden");
  ui.editorSheet?.classList.remove("is-visible");
  ui.editorSheet?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("editor-open");
  updateEditorDock();
}

function pushEditorHistoryState() {
  if (history.state?.noteEditor) return;
  history.pushState({ noteEditor: true }, "");
}

function updateEditorDock() {
  const root = document.documentElement;
  if (!document.body.classList.contains("editor-open")) {
    root.style.setProperty("--keyboard-inset", "0px");
    return;
  }

  const toolbarWrap = ui.editorToolbar?.closest(".editor-toolbar-wrap");
  const toolbarHeight = toolbarWrap?.offsetHeight || 52;
  root.style.setProperty("--editor-toolbar-h", `${toolbarHeight}px`);

  const viewport = window.visualViewport;
  if (!viewport) {
    root.style.setProperty("--keyboard-inset", "0px");
    return;
  }

  const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
}

function bindEditorViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const onViewportChange = () => updateEditorDock();
  viewport.addEventListener("resize", onViewportChange);
  viewport.addEventListener("scroll", onViewportChange);
  window.addEventListener("resize", onViewportChange);
}

function initEditorController() {
  if (!(ui.editorBody instanceof HTMLElement)) {
    throw new Error("editorBody missing");
  }
  editorCtrl = createEditorController(ui.editorBody, ui.editorToolbar, onEditorChange);
  setupEditorToolbarExperience();
}

function getEditorPlainText() {
  return editorCtrl?.getText?.() ?? "";
}

function ensureEditorReady() {
  if (editorCtrl) return true;
  showToast("缂栬緫鍣ㄦ湭灏辩华锛岃鍒锋柊椤甸潰");
  return false;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.skin = normalizeSkinId(parsed.skin || "paper");
    if (typeof parsed.darkMode !== "boolean") parsed.darkMode = false;
    if (!parsed.sortField) parsed.sortField = "updated_at";
    if (!parsed.layoutMode) parsed.layoutMode = "list";
    return parsed;
  } catch {
    return { darkMode: false, skin: "paper", sortField: "updated_at", layoutMode: "list" };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setAppearance({ skin, darkMode, save = true } = {}) {
  if (skin) settings.skin = normalizeSkinId(skin);
  if (typeof darkMode === "boolean") settings.darkMode = darkMode;
  applyAppearance(settings.skin, settings.darkMode);
  renderAppearanceUI();
  if (save) saveSettings();
}

function applyTheme() {
  setAppearance({ save: false });
}

function renderAppearanceUI() {
  const activeId = settings.skin || "paper";
  document.querySelectorAll(".skin-tile").forEach((tile) => {
    tile.classList.toggle("is-active", tile.dataset.skin === activeId);
  });
  document.querySelectorAll(".theme-mode").forEach((group) => {
    group.dataset.mode = settings.darkMode ? "dark" : "light";
    group.querySelectorAll("[data-theme-mode]").forEach((button) => {
      const active = button.dataset.themeMode === (settings.darkMode ? "dark" : "light");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  });
}

function createSkinTile(skin) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "skin-tile tap-scale";
  button.dataset.skin = skin.id;
  button.setAttribute("aria-label", skin.label);
  button.title = skin.label;

  const preview = document.createElement("span");
  preview.className = "skin-tile__preview";
  preview.style.background = skin.preview;

  const label = document.createElement("span");
  label.className = "skin-tile__label";
  label.textContent = skin.label;

  button.append(preview, label);
  button.addEventListener("click", () => {
    setAppearance({ skin: skin.id });
    pulseSkinTile(button);
  });
  return button;
}

function pulseSkinTile(tile) {
  tile.classList.remove("is-pulse");
  void tile.offsetWidth;
  tile.classList.add("is-pulse");
}

function mountSkinGrids() {
  [ui.settingsSkinGrid, ui.editorSkinGrid].forEach((grid) => {
    if (!grid) return;
    grid.innerHTML = "";
    SKINS.forEach((skin) => grid.appendChild(createSkinTile(skin)));
  });
  renderAppearanceUI();
}

function bindThemeModeControls() {
  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextDark = button.dataset.themeMode === "dark";
      if (nextDark === settings.darkMode) return;
      setAppearance({ darkMode: nextDark });
    });
  });
}

const SHEET_CLOSE_MS = 360;

function openActionSheet(sheet) {
  if (!(sheet instanceof HTMLElement)) return;
  closeAllEditorSheets(sheet.id);
  sheet.classList.remove("is-hidden");
  sheet.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.classList.add("is-visible"));
  });
}

function closeActionSheet(sheet) {
  if (!(sheet instanceof HTMLElement)) return;
  if (sheet.classList.contains("is-hidden")) return;
  sheet.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!sheet.classList.contains("is-visible")) {
      sheet.classList.add("is-hidden");
      sheet.setAttribute("aria-hidden", "true");
    }
  }, SHEET_CLOSE_MS);
}

function closeAllEditorSheets(exceptId = "") {
  [ui.editorMoreSheet, ui.editorShareSheet, ui.editorSkinSheet, ui.editorMoveSheet].forEach((sheet) => {
    if (!sheet || sheet.id === exceptId) return;
    closeActionSheet(sheet);
  });
}

function showFindBar() {
  ui.editorFindBar?.classList.remove("is-hidden");
  ui.editorFindInput?.focus();
}

function hideFindBar() {
  ui.editorFindBar?.classList.add("is-hidden");
  if (ui.editorFindInput) ui.editorFindInput.value = "";
}

function findInEditor(forward = true) {
  const query = ui.editorFindInput?.value.trim();
  if (!query) {
    showToast("璇疯緭鍏ユ煡鎵惧唴瀹?);
    return;
  }
  ui.editorBody?.focus();
  const found = window.find(query, false, !forward, true, false, true, false);
  if (!found) showToast("鏈壘鍒板尮閰嶅唴瀹?);
}

function renderSkinSelection() {
  renderAppearanceUI();
}

function renderSkinPicker() {
  mountSkinGrids();
}

function renderMoveTargets() {
  if (!ui.editorMoveList) return;
  ui.editorMoveList.innerHTML = "";
  const targets = [{ id: "", name: "榛樿绗旇鏈? }, ...state.categories.map((item) => ({ id: item.id, name: item.name }))];
  targets.forEach((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-sheet__item tap-scale";
    button.textContent = target.name;
    button.addEventListener("click", () => void moveCurrentNote(target.id));
    ui.editorMoveList.appendChild(button);
  });
}

async function moveCurrentNote(categoryId) {
  if (!state.editorEntryId) return;
  const entry = await getEntry(state.editorEntryId);
  if (!entry) return;
  await putEntry({ ...entry, category_id: categoryId || null, updated_at: new Date().toISOString() });
  closeActionSheet(ui.editorMoveSheet);
  showToast(categoryId ? "宸茬Щ鍔? : "宸茬Щ鍒伴粯璁ょ瑪璁版湰");
  scheduleCloudPush();
}

function getNoteBodyPlain(html = getEditorBody()) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  wrapper.querySelector("h1.note-title")?.remove();
  return htmlToPlainText(wrapper.innerHTML).trim();
}

async function handleShareAction(type) {
  closeActionSheet(ui.editorShareSheet);
  const title = deriveTitle(getEditorBody());
  const plain = getNoteBodyPlain();
  const html = getEditorBody();
  try {
    if (type === "text") {
      await shareAsText(title, plain);
      showToast("宸插垎浜枃瀛?);
      return;
    }
    if (type === "image") {
      await shareAsImage(title, plain || title);
      showToast("宸茬敓鎴愬浘鐗?);
      return;
    }
    if (type === "link") {
      if (!state.editorEntryId) throw new Error("璇峰厛淇濆瓨绗旇");
      await persistEditor(true);
      const url = await shareAsLink(state.editorEntryId);
      showToast(url ? "閾炬帴宸插鍒? : "宸插垎浜摼鎺?);
      return;
    }
    if (type === "word") {
      await shareAsWord(title, html);
      showToast("宸插鍑?Word 鏂囨。");
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Share failed", error);
    showToast(error?.message || "鍒嗕韩澶辫触");
  }
}

function showToast(message, duration = 2600) {
  if (!ui.syncToast) return;
  ui.syncToast.textContent = message;
  ui.syncToast.classList.remove("is-hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.syncToast.classList.add("is-hidden"), duration);
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function showCustomConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customConfirmModal");
    const titleEl = document.getElementById("customConfirmTitle");
    const msgEl = document.getElementById("customConfirmMessage");
    const cancelBtn = document.getElementById("customConfirmCancelBtn");
    const confirmBtn = document.getElementById("customConfirmConfirmBtn");

    if (!modal || !titleEl || !msgEl || !cancelBtn || !confirmBtn) {
      resolve(confirm(message));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    modal.classList.remove("is-hidden");
    // Ensure styles are applied before transitioning
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add("is-visible");
      });
    });

    const cleanup = (value) => {
      modal.classList.remove("is-visible");
      setTimeout(() => {
        modal.classList.add("is-hidden");
      }, 200);
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      resolve(value);
    };

    function onCancel() {
      cleanup(false);
    }
    function onConfirm() {
      cleanup(true);
    }

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

function showCustomPrompt(title, defaultValue = "") {
  return new Promise((resolve) => {
    const modal = document.getElementById("customPromptModal");
    const titleEl = document.getElementById("customPromptTitle");
    const inputEl = document.getElementById("customPromptInput");
    const cancelBtn = document.getElementById("customPromptCancelBtn");
    const confirmBtn = document.getElementById("customPromptConfirmBtn");

    if (!modal || !titleEl || !inputEl || !cancelBtn || !confirmBtn) {
      resolve(prompt(title, defaultValue));
      return;
    }

    titleEl.textContent = title;
    inputEl.value = defaultValue;

    modal.classList.remove("is-hidden");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add("is-visible");
        inputEl.focus();
        inputEl.select();
      });
    });

    const cleanup = (value) => {
      modal.classList.remove("is-visible");
      setTimeout(() => {
        modal.classList.add("is-hidden");
      }, 200);
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      inputEl.removeEventListener("keydown", onKeyDown);
      resolve(value);
    };

    function onCancel() {
      cleanup(null);
    }
    function onConfirm() {
      cleanup(inputEl.value);
    }
    function onKeyDown(e) {
      if (e.key === "Enter") {
        onConfirm();
      } else if (e.key === "Escape") {
        onCancel();
      }
    }

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    inputEl.addEventListener("keydown", onKeyDown);
  });
}

function formatRelativeTime(iso) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "鍒氬垰";
  if (minutes < 60) return `${minutes} 鍒嗛挓鍓峘;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 灏忔椂鍓峘;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 澶╁墠`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function deriveTitle(body) {
  const html = String(body || "");
  const titleMatch = html.match(/<h1[^>]*class="[^"]*note-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    const titleText = htmlToPlainText(titleMatch[1]).trim();
    if (titleText) return titleText.length > 42 ? `${titleText.slice(0, 42)}鈥 : titleText;
  }
  const plain = htmlToPlainText(body);
  const line = plain
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "鏃犳爣棰?;
  return line.length > 42 ? `${line.slice(0, 42)}鈥 : line;
}

function countChars(text) {
  const plain = /<[a-z]/i.test(String(text || "")) ? htmlToPlainText(text) : String(text || "");
  return Array.from(plain).length;
}

function getCategoryName(categoryId) {
  if (!categoryId) return "";
  return state.categories.find((item) => item.id === categoryId)?.name || "";
}

function getActiveCategoryFilterId() {
  if (state.listFilter.startsWith(CATEGORY_FILTER_PREFIX)) {
    return state.listFilter.slice(CATEGORY_FILTER_PREFIX.length);
  }
  return null;
}

function selectListFilter(filterId) {
  if (state.listFilter === filterId) return;
  if (state.multiSelect?.active) {
    exitMultiSelectMode();
  }
  blurActiveElement();
  state.listFilter = filterId;
  renderListFilters();
  renderEntryList();
  updateShellState();
}

function openListActionSheet(sheet) {
  if (!(sheet instanceof HTMLElement)) return;
  sheet.classList.remove("is-hidden");
  sheet.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.classList.add("is-visible"));
  });
}

function closeListActionSheet(sheet) {
  if (!(sheet instanceof HTMLElement)) return;
  if (sheet.classList.contains("is-hidden")) return;
  sheet.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!sheet.classList.contains("is-visible")) {
      sheet.classList.add("is-hidden");
      sheet.setAttribute("aria-hidden", "true");
    }
  }, SHEET_CLOSE_MS);
}

function openCategoryManageSheet() {
  renderCategoryManageList();
  openListActionSheet(ui.categoryManageSheet);
  ui.categoryNameInput?.focus();
}

async function createCategory(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    showToast("璇疯緭鍏ョ瑪璁版湰鍚嶇О");
    return null;
  }
  if (state.categories.some((item) => item.name === trimmed)) {
    showToast("宸叉湁鍚屽悕绗旇鏈?);
    return null;
  }
  const now = new Date().toISOString();
  const maxOrder = state.categories.reduce((max, item) => Math.max(max, item.sort_order || 0), -1);
  const category = {
    id: crypto.randomUUID(),
    name: trimmed,
    sort_order: maxOrder + 1,
    created_at: now,
    updated_at: now
  };
  await putCategory(category);
  if (isSyncConfigured()) {
    try {
      const session = await ensureSession();
      if (session?.user?.id) await pushCategory(category, session.user.id);
    } catch (error) {
      console.warn("Push category failed", error);
    }
  }
  await reloadData();
  renderListFilters();
  renderCategoryManageList();
  showToast(`宸插垱寤恒€?{trimmed}銆峘);
  return category;
}

async function renameCategory(categoryId, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  if (state.categories.some((item) => item.id !== categoryId && item.name === trimmed)) {
    showToast("宸叉湁鍚屽悕绗旇鏈?);
    return;
  }
  const next = { ...category, name: trimmed, updated_at: new Date().toISOString() };
  await putCategory(next);
  scheduleCloudPush();
  await reloadData();
  renderListFilters();
  renderCategoryManageList();
  renderEntryList();
  showToast("宸查噸鍛藉悕");
}

async function removeCategory(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  const confirmed = await showCustomConfirm("鍒犻櫎绗旇鏈?, `纭畾瑕佸垹闄ょ瑪璁版湰銆?{category.name}銆嶅悧锛熷叾涓殑绗旇灏嗙Щ鍒伴粯璁ょ瑪璁版湰銆俙);
  if (!confirmed) return;

  await deleteCategory(categoryId);
  if (isSyncConfigured()) {
    try {
      const session = await ensureSession();
      if (session?.user?.id) await deleteCategoryRemote(categoryId, session.user.id);
      await syncAllPending();
    } catch (error) {
      console.warn("Delete category remote failed", error);
      scheduleCloudPush();
    }
  }

  if (state.listFilter === `${CATEGORY_FILTER_PREFIX}${categoryId}`) {
    state.listFilter = "all";
  }
  await reloadData();
  renderListFilters();
  renderCategoryManageList();
  renderEntryList();
  updateShellState();
  showToast("宸插垹闄ょ瑪璁版湰");
}

function renderCategoryManageList() {
  if (!ui.categoryManageList) return;
  ui.categoryManageList.innerHTML = "";

  if (state.categories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "category-manage__empty";
    empty.textContent = "杩樻病鏈夌瑪璁版湰锛屽湪涓婃柟杈撳叆鍚嶇О娣诲姞銆?;
    ui.categoryManageList.appendChild(empty);
    return;
  }

  state.categories.forEach((category) => {
    const row = document.createElement("li");
    row.className = "category-manage__item";

    const name = document.createElement("span");
    name.className = "category-manage__name";
    name.textContent = category.name;

    const actions = document.createElement("div");
    actions.className = "category-manage__actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "category-manage__btn tap-scale";
    renameBtn.textContent = "閲嶅懡鍚?;
    renameBtn.addEventListener("click", async () => {
      const nextName = await showCustomPrompt("淇敼绗旇鏈悕绉?, category.name);
      if (nextName != null) void renameCategory(category.id, nextName);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "category-manage__btn category-manage__btn--danger tap-scale";
    deleteBtn.textContent = "鍒犻櫎";
    deleteBtn.addEventListener("click", () => void removeCategory(category.id));

    actions.append(renameBtn, deleteBtn);
    row.append(name, actions);
    ui.categoryManageList.appendChild(row);
  });
}

function filteredEntries() {
  const query = state.searchQuery.trim().toLowerCase();
  const inTrash = state.listFilter === "trash";
  const categoryId = getActiveCategoryFilterId();

  return state.entries
    .filter((entry) => {
      const deleted = Boolean(entry.deleted_at);
      if (inTrash ? !deleted : deleted) return false;
      if (!inTrash && categoryId && entry.category_id !== categoryId) return false;
      if (!query) return true;
      const title = (entry.title || deriveTitle(entry.body)).toLowerCase();
      const bodyPlain = htmlToPlainText(entry.body).toLowerCase();
      return title.includes(query) || bodyPlain.includes(query);
    })
    .sort((a, b) => {
      if (!inTrash) {
        const aPinned = Boolean(a.is_pinned);
        const bPinned = Boolean(b.is_pinned);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
      }
      const aTime = inTrash ? a.deleted_at : (settings.sortField === "created_at" ? (a.created_at || a.updated_at) : a.updated_at);
      const bTime = inTrash ? b.deleted_at : (settings.sortField === "created_at" ? (b.created_at || b.updated_at) : b.updated_at);
      return new Date(bTime) - new Date(aTime);
    });
}

async function reloadData() {
  state.categories = await getAllCategories();
  state.entries = await getAllEntries(true);
}

function updateShellState() {
  document.body.dataset.screen = state.activeScreen;
  document.body.dataset.filter = state.listFilter;
  const hideFab = state.activeScreen !== "notes" || state.listFilter === "trash";
  ui.fabAddBtn?.classList.toggle("is-hidden", hideFab);
}

function switchScreen(screen) {
  if (state.activeScreen === screen) return;
  if (state.multiSelect?.active) {
    exitMultiSelectMode();
  }
  blurActiveElement();
  state.activeScreen = screen;
  ui.screens.forEach((node) => {
    const active = node.dataset.screen === screen;
    node.classList.toggle("is-active", active);
    node.toggleAttribute("inert", !active);
    node.setAttribute("aria-hidden", active ? "false" : "true");
  });
  ui.navItems.forEach((node) => {
    const active = node.dataset.screen === screen;
    node.classList.toggle("is-active", active);
    node.setAttribute("aria-current", active ? "page" : "false");
  });
  updateShellState();
  if (screen === "settings") renderSettings();
}

function switchScreenWithHistory(screen) {
  if (state.activeScreen === screen) return;
  if (screen === "settings" && state.activeScreen === "notes" && !history.state?.noteScreenSettings) {
    history.pushState({ noteScreenSettings: true }, "");
  }
  switchScreen(screen);
}

function renderListFilters() {
  ui.categoryTabs.innerHTML = "";

  const tabs = [
    { id: "all", name: "鍏ㄩ儴" },
    ...state.categories.map((category) => ({
      id: `${CATEGORY_FILTER_PREFIX}${category.id}`,
      name: category.name
    })),
    { id: "trash", name: "鏈€杩戝垹闄? }
  ];

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-tab tap-scale${state.listFilter === tab.id ? " is-active" : ""}`;
    button.textContent = tab.name;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", state.listFilter === tab.id ? "true" : "false");
    button.addEventListener("click", () => selectListFilter(tab.id));
    ui.categoryTabs.appendChild(button);
  });

  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = "category-tab category-tab--manage tap-scale";
  manageBtn.setAttribute("aria-label", "绠＄悊绗旇鏈?);
  manageBtn.title = "绠＄悊绗旇鏈?;
  manageBtn.textContent = "+";
  manageBtn.addEventListener("click", openCategoryManageSheet);
  ui.categoryTabs.appendChild(manageBtn);
}

function renderEntryList() {
  if (settings.layoutMode === "grid") {
    ui.entryList.classList.add("is-grid");
  } else {
    ui.entryList.classList.remove("is-grid");
  }

  const entries = filteredEntries();
  const inTrash = state.listFilter === "trash";
  const categoryId = getActiveCategoryFilterId();
  const categoryName = categoryId ? getCategoryName(categoryId) : "";
  ui.entryList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-box";
    if (state.searchQuery) {
      empty.innerHTML = "<strong>娌℃湁鍖归厤缁撴灉</strong>璇曡瘯鍏朵粬鍏抽敭璇嶏紝鎴栨竻绌烘悳绱€?;
    } else if (inTrash) {
      empty.innerHTML = "<strong>鏈€杩戝垹闄や负绌?/strong>鍒犻櫎鐨勭瑪璁颁細鍑虹幇鍦ㄨ繖閲屻€?;
    } else if (categoryName) {
      empty.innerHTML = `<strong>銆?{categoryName}銆嶈繕娌℃湁绗旇</strong>鐐瑰彸涓嬭 + 鍦ㄦ绗旇鏈柊寤恒€俙;
    } else {
      empty.innerHTML = "<strong>杩樻病鏈夌瑪璁?/strong>鐐瑰彸涓嬭 + 寮€濮嬪啓銆?;
    }
    ui.entryList.appendChild(empty);
    return;
  }

  const pinnedEntries = (!inTrash) ? entries.filter(e => e.is_pinned) : [];
  const otherEntries = (!inTrash) ? entries.filter(e => !e.is_pinned) : entries;

  let overallIndex = 0;

  function createCard(entry, index) {
    const card = document.createElement("article");
    card.className = "entry-card entry-card--animate tap-scale";
    card.style.animationDelay = `${Math.min(index, 12) * 40}ms`;
    card.dataset.entryId = entry.id;
    if (inTrash) card.dataset.trash = "true";

    const title = entry.title || deriveTitle(entry.body);
    const preview = getNoteBodyPlain(entry.body)
      .replace(/\s+/g, " ")
      .trim();
    const categoryName = getCategoryName(entry.category_id);
    const timeLabel = inTrash
      ? `鍒犻櫎浜?${formatRelativeTime(entry.deleted_at)}`
      : `${formatRelativeTime(entry.updated_at)} 路 ${countChars(entry.body)} 瀛梎;

    const isPinned = Boolean(entry.is_pinned);
    const isSelected = state.multiSelect?.active && state.multiSelect.selectedIds.has(entry.id);
    if (isPinned) card.classList.add("is-pinned");

    const checkedClass = isSelected ? "is-checked" : "";

    const match = entry.body ? entry.body.match(/<img[^>]+src=["']([^"']+)["']/i) : null;
    const firstImgSrc = match ? match[1] : null;
    const imgHtml = firstImgSrc ? `<div class="entry-card__img-preview"><img src="${firstImgSrc}" alt="Note image" loading="lazy"></div>` : "";
    const pinLabel = entry.is_pinned ? "取消置顶" : "置顶";
    const SWIPE_ACTIONS_BLOCK = inTrash
      ? `<div class="entry-card__actions" data-action="swipe-actions"><button type="button" class="entry-card__action entry-card__action--restore" data-swipe-action="restore">恢复</button></div>`
      : `<div class="entry-card__actions" data-action="swipe-actions"><button type="button" class="entry-card__action entry-card__action--pin" data-swipe-action="pin">${pinLabel}</button><button type="button" class="entry-card__action entry-card__action--move" data-swipe-action="move">移动</button><button type="button" class="entry-card__action entry-card__action--delete" data-swipe-action="delete">删除</button></div>`;

    card.innerHTML = `
      ${SWIPE_ACTIONS_BLOCK}
      <div class="entry-card__inner">
        <h3 class="entry-card__title"><span class="entry-card__title-text"></span></h3>
        <p class="entry-card__preview"></p>
        ${imgHtml}
        <div class="entry-card__meta">
          <span class="entry-card__tag${categoryName ? "" : " is-hidden"}"></span>
          <span class="entry-card__time"></span>
        </div>
      </div>
      <div class="entry-card__checkbox ${checkedClass}"></div>
    `;

    card.querySelector(".entry-card__title-text").textContent = title;
    card.querySelector(".entry-card__preview").textContent = preview || "锛堢┖鍐呭锛?;
    const tag = card.querySelector(".entry-card__tag");
    if (categoryName) tag.textContent = categoryName;
    card.querySelector(".entry-card__time").textContent = timeLabel;

    bindSwipe(card, entry.id, inTrash);
    return card;
  }

  // Render Pinned Section if exists
  if (pinnedEntries.length > 0) {
    const pinnedHeader = document.createElement("div");
    pinnedHeader.className = "entry-section-header entry-section-header--pinned" + (state.pinnedCollapsed ? " is-collapsed" : " is-expanded");
    pinnedHeader.innerHTML = `
      <div class="entry-section-header__title">缃《</div>
      <button type="button" class="entry-section-header__toggle" aria-label="灞曞紑鎴栨敹璧风疆椤?>
        <svg class="entry-section-header__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    `;
    pinnedHeader.addEventListener("click", () => {
      state.pinnedCollapsed = !state.pinnedCollapsed;
      renderEntryList();
    });
    ui.entryList.appendChild(pinnedHeader);

    if (!state.pinnedCollapsed) {
      pinnedEntries.forEach((entry, idx) => {
        const card = createCard(entry, overallIndex++);
        if (idx === 0) card.classList.add("is-first-in-group");
        if (idx === pinnedEntries.length - 1) card.classList.add("is-last-in-group");
        ui.entryList.appendChild(card);
      });
    }

    // Render separator/Other section header if other notes exist
    if (otherEntries.length > 0) {
      const othersHeader = document.createElement("div");
      othersHeader.className = "entry-section-header entry-section-header--others";
      othersHeader.innerHTML = `<div class="entry-section-header__title">鍏朵粬绗旇</div>`;
      ui.entryList.appendChild(othersHeader);

      otherEntries.forEach((entry, idx) => {
        const card = createCard(entry, overallIndex++);
        if (idx === 0) card.classList.add("is-first-in-group");
        if (idx === otherEntries.length - 1) card.classList.add("is-last-in-group");
        ui.entryList.appendChild(card);
      });
    }
  } else {
    // Render flat list
    otherEntries.forEach((entry, idx) => {
      const card = createCard(entry, overallIndex++);
      if (idx === 0) card.classList.add("is-first-in-group");
      if (idx === otherEntries.length - 1) card.classList.add("is-last-in-group");
      ui.entryList.appendChild(card);
    });
  }
}

function bindSwipe(card, entryId, inTrash) {
  const inner = card.querySelector(".entry-card__inner");
  const actions = card.querySelector("[data-action='swipe-actions']");
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let tracking = false;
  let isScrolling = false;
  let longPressTimer = null;
  let longPressed = false;

  inner.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    currentX = 0;
    tracking = true;
    isScrolling = false;
    longPressed = false;

    // Elegant tactical press feedback scaling
    card.classList.add("is-touching");

    if (longPressTimer) clearTimeout(longPressTimer);

    if (!state.multiSelect?.active) {
      longPressTimer = setTimeout(() => {
        if (tracking && !isScrolling) {
          longPressed = true;
          if (navigator.vibrate) {
            navigator.vibrate(60);
          }
          enterMultiSelectMode(entryId);
        }
      }, 400);
    }
  });

  inner.addEventListener("pointermove", (event) => {
    if (!tracking) return;
    const diffX = event.clientX - startX;
    const diffY = event.clientY - startY;

    if (Math.abs(diffY) > 20 && !isScrolling) {
      isScrolling = true;
      card.classList.remove("is-touching"); // Cancel scale when scrolling vertically
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    if (isScrolling) return;

    if (Math.abs(diffX) > 20) {
      card.classList.remove("is-touching"); // Cancel scale when scrolling/swiping horizontally
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    if (state.multiSelect?.active) return;

    currentX = Math.min(0, Math.max(-188, diffX));
    if (Math.abs(currentX) > 6) {
      inner.style.transform = `translateX(${currentX}px)`;
      if (!inner.hasPointerCapture(event.pointerId)) {
        inner.setPointerCapture(event.pointerId);
      }
    }
  });

  const finishGesture = (event) => {
    card.classList.remove("is-touching"); // Always slide back to 100% scale safely
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (!tracking) return;
    tracking = false;

    if (inner.hasPointerCapture(event.pointerId)) {
      inner.releasePointerCapture(event.pointerId);
    }

    inner.style.transform = "";

    if (event.type === "pointercancel") {
      return;
    }

    if (longPressed) {
      return;
    }

    const tapped = Math.abs(event.clientX - startX) < 15 && Math.abs(event.clientY - startY) < 15 && !isScrolling;

    if (tapped) {
      if (state.multiSelect?.active) {
        toggleEntrySelected(entryId);
        return;
      }

      if (card.classList.contains("is-swiped")) {
        card.classList.remove("is-swiped");
        state.swipe.activeId = null;
        return;
      }
      if (inTrash) void restoreEntryById(entryId);
      else void openEditor(entryId);
      return;
    }

    if (state.multiSelect?.active) return;

    card.classList.toggle("is-swiped", currentX <= -56);
    if (state.swipe.activeId && state.swipe.activeId !== entryId) {
      document.querySelectorAll(".entry-card.is-swiped").forEach((node) => {
        if (node.dataset.entryId !== entryId) node.classList.remove("is-swiped");
      });
    }
    state.swipe.activeId = card.classList.contains("is-swiped") ? entryId : null;
    currentX = 0;
  };

  inner.addEventListener("pointerup", finishGesture);
  inner.addEventListener("pointercancel", finishGesture);
  inner.addEventListener("contextmenu", (event) => {
    // Prevent default context menu on mobile/desktop during long press (keeps custom UI clean)
    event.preventDefault();
  });

  actions?.addEventListener("click", (event) => {
    event.stopPropagation();
    const btn = event.target.closest("[data-swipe-action]");
    if (!btn) return;
    const action = btn.dataset.swipeAction;
    if (action === "restore") {
      void restoreEntryById(entryId);
      return;
    }
    if (action === "delete") {
      void deleteEntry(entryId);
      return;
    }
    if (action === "pin") {
      void togglePinEntry(entryId);
      return;
    }
    if (action === "move") {
      void moveEntryQuick(entryId);
    }
  });
}

async function togglePinEntry(entryId) {
  const entry = await getEntry(entryId);
  if (!entry || entry.deleted_at) return;
  await putEntry({
    ...entry,
    is_pinned: !entry.is_pinned,
    updated_at: new Date().toISOString()
  });
  showToast(entry.is_pinned ? "宸插彇娑堢疆椤? : "宸茬疆椤?);
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
}

async function moveEntryQuick(entryId) {
  const entry = await getEntry(entryId);
  if (!entry || entry.deleted_at) return;
  const currentId = entry.category_id || "";
  const targets = [{ id: "", name: "榛樿绗旇鏈? }, ...state.categories.map((item) => ({ id: item.id, name: item.name }))].filter((t) => t.id !== currentId);
  if (targets.length === 0) {
    showToast("鏆傛棤鍙Щ鍔ㄧ洰鏍?);
    return;
  }
  const next = targets[0];
  await putEntry({
    ...entry,
    category_id: next.id || null,
    updated_at: new Date().toISOString()
  });
  showToast(`宸茬Щ鍔ㄥ埌${next.name}`);
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
}

// ======================== 澶氶€夊強缃《鎿嶄綔绯诲垪鏂规硶 ========================
function enterMultiSelectMode(initialEntryId = null) {
  state.multiSelect.active = true;
  state.multiSelect.selectedIds.clear();
  if (initialEntryId) {
    state.multiSelect.selectedIds.add(initialEntryId);
  }
  
  document.body.dataset.multiselect = "true";
  
  document.getElementById("normalTopbar")?.classList.add("is-hidden");
  document.getElementById("multiSelectTopbar")?.classList.remove("is-hidden");
  
  document.querySelector(".mobile-nav")?.classList.add("is-hidden");
  document.getElementById("multiSelectActionBar")?.classList.remove("is-hidden");
  ui.fabAddBtn?.classList.add("is-hidden");
  
  updateMultiSelectUI();
}

function exitMultiSelectMode() {
  state.multiSelect.active = false;
  state.multiSelect.selectedIds.clear();
  
  document.body.removeAttribute("data-multiselect");
  
  document.getElementById("normalTopbar")?.classList.remove("is-hidden");
  document.getElementById("multiSelectTopbar")?.classList.add("is-hidden");
  
  document.querySelector(".mobile-nav")?.classList.remove("is-hidden");
  document.getElementById("multiSelectActionBar")?.classList.add("is-hidden");
  
  const hideFab = state.activeScreen !== "notes" || state.listFilter === "trash";
  ui.fabAddBtn?.classList.toggle("is-hidden", hideFab);
  
  updateMultiSelectUI();
}

function toggleEntrySelected(entryId) {
  if (!state.multiSelect.active) return;
  if (state.multiSelect.selectedIds.has(entryId)) {
    state.multiSelect.selectedIds.delete(entryId);
  } else {
    state.multiSelect.selectedIds.add(entryId);
  }
  updateMultiSelectUI();
}

function updateMultiSelectUI() {
  const selectedCount = state.multiSelect.selectedIds.size;
  const titleEl = document.getElementById("multiSelectTitle");
  if (titleEl) {
    titleEl.textContent = `宸查€夋嫨 ${selectedCount} 椤筦;
  }
  
  const entries = filteredEntries();
  const allBtn = document.getElementById("multiSelectAllBtn");
  if (allBtn) {
    const allSelected = entries.length > 0 && entries.every(e => state.multiSelect.selectedIds.has(e.id));
    allBtn.textContent = allSelected ? "鍙栨秷鍏ㄩ€? : "鍏ㄩ€?;
  }

  const batchPinText = document.getElementById("batchPinText");
  if (batchPinText) {
    const selectedEntries = Array.from(state.multiSelect.selectedIds).map(id => state.entries.find(e => e.id === id)).filter(Boolean);
    const allPinned = selectedEntries.length > 0 && selectedEntries.every(e => e.is_pinned);
    batchPinText.textContent = allPinned ? "鍙栨秷缃《" : "缃《";
  }
  
  document.querySelectorAll(".entry-card").forEach(card => {
    const id = card.dataset.entryId;
    const checkbox = card.querySelector(".entry-card__checkbox");
    if (checkbox) {
      const isChecked = state.multiSelect.selectedIds.has(id);
      checkbox.classList.toggle("is-checked", isChecked);
    }
  });
}

function toggleSelectAll() {
  const entries = filteredEntries();
  const allSelected = entries.length > 0 && entries.every(e => state.multiSelect.selectedIds.has(e.id));
  
  if (allSelected) {
    entries.forEach(e => state.multiSelect.selectedIds.delete(e.id));
  } else {
    entries.forEach(e => state.multiSelect.selectedIds.add(e.id));
  }
  updateMultiSelectUI();
}

function updateMoreMenuUI() {
  const viewModeByText = document.getElementById("viewModeText");
  const viewModeByIcon = document.getElementById("viewModeIcon");
  if (viewModeByText) {
    viewModeByText.textContent = settings.layoutMode === "grid" ? "鍒楄〃妯″紡" : "瀹牸妯″紡";
  }
  if (viewModeByIcon) {
    if (settings.layoutMode === "grid") {
      viewModeByIcon.innerHTML = `
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      `;
    } else {
      viewModeByIcon.innerHTML = `
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      `;
    }
  }

  const sortCreatedCheck = document.getElementById("sortCreatedCheck");
  const sortModifiedCheck = document.getElementById("sortModifiedCheck");
  if (sortCreatedCheck) {
    sortCreatedCheck.classList.toggle("is-hidden", settings.sortField !== "created_at");
  }
  if (sortModifiedCheck) {
    sortModifiedCheck.classList.toggle("is-hidden", settings.sortField !== "updated_at");
  }
}

function openMoreMenu() {
  updateMoreMenuUI();
  ui.moreMenuPopover?.classList.remove("is-hidden");
}

function closeMoreMenu() {
  ui.moreMenuPopover?.classList.add("is-hidden");
}

function openBatchMoveSheet() {
  const listEl = document.getElementById("batchMoveList");
  if (!listEl) return;
  listEl.innerHTML = "";
  
  const targets = [{ id: "", name: "榛樿绗旇鏈? }, ...state.categories.map((item) => ({ id: item.id, name: item.name }))];
  targets.forEach((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-sheet__item tap-scale";
    button.textContent = target.name;
    button.addEventListener("click", () => void executeBatchMove(target.id));
    listEl.appendChild(button);
  });
  
  openActionSheet(document.getElementById("batchMoveSheet"));
}

async function executeBatchMove(categoryId) {
  if (state.multiSelect.selectedIds.size === 0) return;
  
  const selectedIds = Array.from(state.multiSelect.selectedIds);
  const now = new Date().toISOString();
  
  for (const id of selectedIds) {
    const entry = await getEntry(id);
    if (entry) {
      await putEntry({
         ...entry,
         category_id: categoryId || null,
         updated_at: now
      });
    }
  }
  
  closeActionSheet(document.getElementById("batchMoveSheet"));
  showToast(categoryId ? "鎵归噺绉诲姩鎴愬姛" : "宸茬Щ鍒伴粯璁ょ瑪璁版湰");
  exitMultiSelectMode();
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
}

async function executeBatchPin() {
  if (state.multiSelect.selectedIds.size === 0) return;
  
  const selectedEntries = Array.from(state.multiSelect.selectedIds).map(id => state.entries.find(e => e.id === id)).filter(Boolean);
  const allPinned = selectedEntries.length > 0 && selectedEntries.every(e => e.is_pinned);
  
  const now = new Date().toISOString();
  for (const entry of selectedEntries) {
    await putEntry({
      ...entry,
      is_pinned: !allPinned,
      updated_at: now
    });
  }
  
  showToast(allPinned ? "宸插彇娑堢疆椤? : "宸茶涓虹疆椤?);
  exitMultiSelectMode();
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
}

async function executeBatchDelete() {
  const count = state.multiSelect.selectedIds.size;
  if (count === 0) return;
  
  const inTrash = state.listFilter === "trash";
  const confirmMsg = inTrash ? `纭畾瑕佹案涔呭垹闄よ繖 ${count} 绡囩瑪璁板悧锛熷垹闄ゅ悗涓嶅彲鎭㈠銆俙 : `纭畾瑕佸皢杩?${count} 绡囩瑪璁扮Щ鍔ㄥ埌鏈€杩戝垹闄ゅ悧锛焋;
  
  const confirmed = await showCustomConfirm(inTrash ? "姘镐箙鍒犻櫎" : "鍒犻櫎绗旇", confirmMsg);
  if (!confirmed) return;
  
  const selectedIds = Array.from(state.multiSelect.selectedIds);
  
  for (const id of selectedIds) {
    if (inTrash) {
      await deleteEntryPermanent(id);
    } else {
      await markEntryDeleted(id);
    }
  }
  
  showToast(inTrash ? "宸叉案涔呭垹闄? : "宸茬Щ鍔ㄥ埌鏈€杩戝垹闄?);
  exitMultiSelectMode();
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
}

async function openEditor(entryId = null) {
  if (!ensureEditorReady()) return;
  let entry;
  if (entryId) {
    entry = await getEntry(entryId);
    if (!entry || entry.deleted_at) return;
  } else {
    const now = new Date().toISOString();
    entry = {
      id: crypto.randomUUID(),
      user_id: "",
      category_id: getActiveCategoryFilterId(),
      title: "",
      body: "",
      created_at: now,
      updated_at: now,
      deleted_at: null
    };
    await putEntry(entry);
    state.entries.unshift(entry);
  }

  state.editorEntryId = entry.id;
  const isBlankNote = !String(entry.body || "").trim();
  editorCtrl.reset(entry.body || "");
  closeAllEditorSheets();
  hideFindBar();

  ui.editorSheet.classList.remove("is-hidden");
  ui.editorSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("editor-open");
  pushEditorHistoryState();
  requestAnimationFrame(() => {
    ui.editorSheet?.classList.add("is-visible");
    updateEditorDock();
    if (isBlankNote) editorCtrl.focusTitle();
    else ui.editorBody.focus();
  });
}

async function closeEditor({ fromPopstate = false } = {}) {
  if (!state.editorEntryId && !document.body.classList.contains("editor-open")) return;

  if (state.autoSaveTimer) {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
    await persistEditor(true);
  }

  const closingId = state.editorEntryId;
  if (closingId) {
    const entry = await getEntry(closingId);
    if (entry && editorCtrl?.isEmpty?.()) {
      await deleteEntryPermanent(closingId);
    }
  }

  state.editorEntryId = null;
  blurActiveElement();
  closeAllEditorSheets();
  hideFindBar();
  ui.editorSheet?.classList.remove("is-visible");
  document.body.classList.remove("editor-open");
  window.setTimeout(() => {
    ui.editorSheet.classList.add("is-hidden");
    ui.editorSheet.setAttribute("aria-hidden", "true");
    updateEditorDock();
  }, SHEET_CLOSE_MS);

  if (!fromPopstate && history.state?.noteEditor) {
    state.suppressEditorPopstate = true;
    history.back();
  }

  await reloadData();
  renderListFilters();
  renderEntryList();
}

function updateEditorMeta() {}

async function persistEditor(silent = false) {
  if (!state.editorEntryId) return;
  const entry = await getEntry(state.editorEntryId);
  if (!entry) return;

  const body = getEditorBody();
  const now = new Date().toISOString();
  const next = {
    ...entry,
    body,
    title: deriveTitle(body),
    updated_at: now
  };

  await putEntry(next);
  if (!silent) showToast("宸蹭繚瀛?, 1200);
  scheduleCloudPush();
}

function scheduleAutoSave() {
  if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(() => {
    state.autoSaveTimer = null;
    void persistEditor(true);
  }, AUTO_SAVE_MS);
}

function scheduleCloudPush() {
  if (!isSyncConfigured()) return;
  if (state.cloudSyncTimer) clearTimeout(state.cloudSyncTimer);
  state.cloudSyncTimer = setTimeout(() => {
    state.cloudSyncTimer = null;
    void runCloudSync(false);
  }, 1200);
}

async function deleteEntry(entryId) {
  const confirmed = await showCustomConfirm("鍒犻櫎绗旇", "纭畾瑕佸皢杩欐潯绗旇绉诲姩鍒版渶杩戝垹闄ゅ悧锛?);
  if (!confirmed) return;
  await markEntryDeleted(entryId);
  if (state.editorEntryId === entryId) await closeEditor();
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
  showToast("宸茬Щ鍒版渶杩戝垹闄?);
}

async function restoreEntryById(entryId) {
  await restoreEntry(entryId);
  await reloadData();
  renderEntryList();
  scheduleCloudPush();
  showToast("宸叉仮澶?);
}

function renderSettings() {
  const config = getSyncConfig();
  ui.syncUrlInput.value = config.url || "";
  ui.syncKeyInput.value = config.anonKey || "";
  renderAppearanceUI();
  void refreshSyncStatusText();
}

async function refreshSyncStatusText() {
  if (!isSyncConfigured()) {
    ui.syncStatus.textContent = "灏氭湭閰嶇疆浜戠";
    return;
  }
  const meta = await getLastSyncMeta();
  const parts = ["宸查厤缃?Supabase"];
  if (meta.lastPushAt) parts.push(`涓婃涓婁紶 ${formatRelativeTime(meta.lastPushAt)}`);
  if (meta.lastPullAt) parts.push(`涓婃鎷夊彇 ${formatRelativeTime(meta.lastPullAt)}`);
  ui.syncStatus.textContent = parts.join(" 路 ");
}

async function runCloudSync(showFeedback = true) {
  if (!isSyncConfigured()) {
    if (showFeedback) showToast("璇峰厛鍦ㄨ缃腑閰嶇疆 Supabase");
    return;
  }
  try {
    if (showFeedback) ui.syncStatus.textContent = "鍚屾涓€?;
    await pullRemote();
    await syncAllPending();
    await refreshSyncStatusText();
    if (showFeedback) showToast("鍚屾瀹屾垚");
  } catch (error) {
    console.warn("Sync failed", error);
    ui.syncStatus.textContent = `鍚屾澶辫触锛?{error.message || "鏈煡閿欒"}`;
    if (showFeedback) showToast("鍚屾澶辫触锛屽唴瀹瑰凡淇濈暀鍦ㄦ湰鍦?);
  }
}

async function saveSyncSettings() {
  saveSyncConfig({
    url: ui.syncUrlInput.value,
    anonKey: ui.syncKeyInput.value
  });
  if (!isSyncConfigured()) {
    showToast("璇峰～鍐欏畬鏁寸殑 URL 涓?Anon Key");
    return;
  }
  try {
    ui.syncStatus.textContent = "杩炴帴涓€?;
    const session = await ensureSession();
    if (!session?.user?.id) throw new Error("鏃犳硶寤虹珛鍖垮悕浼氳瘽");
    await runCloudSync(true);
  } catch (error) {
    console.warn("Connect failed", error);
    ui.syncStatus.textContent = `杩炴帴澶辫触锛?{error.message || "鏈煡閿欒"}`;
    showToast("杩炴帴澶辫触锛岃妫€鏌ラ厤缃?);
  }
}

function bindEvents() {
  ui.navItems.forEach((button) => {
    button.addEventListener("click", () => {
      blurActiveElement();
      switchScreenWithHistory(button.dataset.screen || "notes");
    });
  });

  ui.fabAddBtn?.addEventListener("click", () => void openEditor());
  ui.bottomAddBtn?.addEventListener("click", () => void openEditor());
  ui.bottomSettingsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (ui.moreMenuPopover?.classList.contains("is-hidden")) {
      openMoreMenu();
    } else {
      closeMoreMenu();
    }
  });
  ui.settingsBackBtn?.addEventListener("click", () => {
    if (history.state?.noteScreenSettings) {
      history.back();
      return;
    }
    switchScreen("notes");
  });

  ui.searchToggleBtn?.addEventListener("click", () => {
    ui.searchBar.classList.toggle("is-hidden");
    if (!ui.searchBar.classList.contains("is-hidden")) ui.searchInput.focus();
  });

  ui.searchInput.addEventListener("input", () => {
    state.searchQuery = ui.searchInput.value;
    if (ui.bottomSearchInput) ui.bottomSearchInput.value = ui.searchInput.value;
    renderEntryList();
  });

  ui.bottomSearchInput?.addEventListener("input", () => {
    state.searchQuery = ui.bottomSearchInput.value;
    if (ui.searchInput) ui.searchInput.value = ui.bottomSearchInput.value;
    renderEntryList();
  });

  ui.searchClearBtn.addEventListener("click", () => {
    ui.searchInput.value = "";
    if (ui.bottomSearchInput) ui.bottomSearchInput.value = "";
    state.searchQuery = "";
    renderEntryList();
  });

  ui.manageCategoriesBtn?.addEventListener("click", openCategoryManageSheet);

  ui.categoryCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = ui.categoryNameInput?.value ?? "";
    void createCategory(name).then((category) => {
      if (category && ui.categoryNameInput) ui.categoryNameInput.value = "";
    });
  });

  ui.categoryManageSheet?.addEventListener("click", (event) => {
    const closeId = event.target.closest("[data-close]")?.dataset.close;
    if (closeId) closeListActionSheet(document.getElementById(closeId));
  });

  ui.editorBackBtn.addEventListener("click", () => void closeEditor());

  window.addEventListener("popstate", () => {
    if (state.suppressEditorPopstate) {
      state.suppressEditorPopstate = false;
      return;
    }
    if (document.body.classList.contains("editor-open")) {
      void closeEditor({ fromPopstate: true });
      return;
    }
    if (state.activeScreen === "settings") {
      switchScreen("notes");
    }
  });

  bindEditorViewport();

  ui.editorBody?.addEventListener("focusin", () => {
    requestAnimationFrame(updateEditorDock);
  });
  ui.editorFindInput?.addEventListener("focusin", () => {
    requestAnimationFrame(updateEditorDock);
  });

  ui.editorShareBtn?.addEventListener("click", () => openActionSheet(ui.editorShareSheet));
  ui.editorMoreBtn?.addEventListener("click", () => openActionSheet(ui.editorMoreSheet));
  ui.editorDeleteBtn.addEventListener("click", () => {
    if (state.editorEntryId) void deleteEntry(state.editorEntryId);
  });

  ui.editorFindNextBtn?.addEventListener("click", () => findInEditor(true));
  ui.editorFindCloseBtn?.addEventListener("click", hideFindBar);
  ui.editorFindInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findInEditor(!event.shiftKey);
    }
    if (event.key === "Escape") hideFindBar();
  });

  ui.editorMoreSheet?.addEventListener("click", (event) => {
    const closeId = event.target.closest("[data-close]")?.dataset.close;
    if (closeId) {
      closeActionSheet(document.getElementById(closeId));
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    closeActionSheet(ui.editorMoreSheet);
    if (action === "find") showFindBar();
    if (action === "skin") {
      renderAppearanceUI();
      openActionSheet(ui.editorSkinSheet);
    }
    if (action === "move") {
      renderMoveTargets();
      openActionSheet(ui.editorMoveSheet);
    }
    if (action === "app-settings") {
      void closeEditor().then(() => switchScreenWithHistory("settings"));
    }
  });

  ui.editorToolbar?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-cmd='toggle-advanced']");
    if (!btn) return;
    event.preventDefault();
    toggleAdvancedToolbar();
  });

  ui.editorShareSheet?.addEventListener("click", (event) => {
    const closeId = event.target.closest("[data-close]")?.dataset.close;
    if (closeId) {
      closeActionSheet(document.getElementById(closeId));
      return;
    }
    const shareType = event.target.closest("[data-share]")?.dataset.share;
    if (shareType) void handleShareAction(shareType);
  });

  [ui.editorSkinSheet, ui.editorMoveSheet].forEach((sheet) => {
    sheet?.addEventListener("click", (event) => {
      const closeId = event.target.closest("[data-close]")?.dataset.close;
      if (closeId) closeActionSheet(document.getElementById(closeId));
    });
  });

  ui.saveSyncBtn.addEventListener("click", () => void saveSyncSettings());
  ui.syncNowBtn.addEventListener("click", () => void runCloudSync(true));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.editorEntryId) {
      void persistEditor(true);
    }
  });

  // 澶氶€夋壒閲忔搷浣滅浉鍏崇殑浜嬩欢澶勭悊
  document.getElementById("multiSelectCancelBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    exitMultiSelectMode();
  });
  document.getElementById("multiSelectAllBtn")?.addEventListener("click", toggleSelectAll);
  
  document.getElementById("batchMoveBtn")?.addEventListener("click", openBatchMoveSheet);
  document.getElementById("batchPinBtn")?.addEventListener("click", () => void executeBatchPin());
  document.getElementById("batchDeleteBtn")?.addEventListener("click", () => void executeBatchDelete());

  // 鏇村鎺掔増涓庤缃脊鍑鸿彍鍗?
  ui.moreMenuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (ui.moreMenuPopover?.classList.contains("is-hidden")) {
      openMoreMenu();
    } else {
      closeMoreMenu();
    }
  });

  ui.moreMenuBackdrop?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMoreMenu();
  });

  ui.moreMenuPopover?.addEventListener("click", (event) => {
    const btn = event.target.closest(".popover-menu__item");
    if (!btn) return;
    event.stopPropagation();
    
    const action = btn.dataset.action;
    if (action === "menu-edit") {
      closeMoreMenu();
      enterMultiSelectMode();
    } else if (action === "menu-view-mode") {
      settings.layoutMode = settings.layoutMode === "grid" ? "list" : "grid";
      saveSettings();
      renderEntryList();
      closeMoreMenu();
    } else if (action === "menu-settings") {
      closeMoreMenu();
      switchScreenWithHistory("settings");
    } else if (action === "menu-sort-created") {
      settings.sortField = "created_at";
      saveSettings();
      renderEntryList();
      closeMoreMenu();
    } else if (action === "menu-sort-modified") {
      settings.sortField = "updated_at";
      saveSettings();
      renderEntryList();
      closeMoreMenu();
    }
  });

  // 鎵归噺绉诲姩绗旇鏈殑鍏抽棴
  document.getElementById("batchMoveSheet")?.addEventListener("click", (event) => {
    const closeId = event.target.closest("[data-close]")?.dataset.close;
    if (closeId) closeActionSheet(document.getElementById(closeId));
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("SW registration failed", error);
  });
}

async function bootstrap() {
  mountSkinGrids();
  bindThemeModeControls();
  applyTheme();
  resetEditorShell();
  bindEvents();

  try {
    initEditorController();
  } catch (error) {
    console.error("Editor init failed", error);
    showToast("缂栬緫鍣ㄥ垵濮嬪寲澶辫触锛岃鍒锋柊椤甸潰");
  }

  registerServiceWorker();

  await initializeSyncConfigFromBackend();

  ui.screens.forEach((node) => {
    const active = node.classList.contains("is-active");
    node.toggleAttribute("inert", !active);
    node.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if (isSyncConfigured()) {
    await runCloudSync(false);
  }

  await reloadData();
  renderListFilters();
  renderEntryList();
  renderSettings();
  updateShellState();

  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") {
    void openEditor();
    window.history.replaceState({}, "", window.location.pathname);
  } else if (params.get("note")) {
    const noteId = params.get("note");
    window.history.replaceState({}, "", window.location.pathname);
    void openEditor(noteId);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  showToast("鍚姩澶辫触锛岃鍒锋柊椤甸潰");
});

