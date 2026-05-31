export const SKINS = [
  { id: "paper", label: "纸墨", preview: "#faf7f2" },
  { id: "snow", label: "雪白", preview: "#f2f2f7" },
  { id: "sepia", label: "暖黄", preview: "#f4ecd8" },
  { id: "green", label: "护眼", preview: "#edf5ef" },
  { id: "blue", label: "浅蓝", preview: "#eef4fa" },
  { id: "sand", label: "沙棕", preview: "#f5efe6" },
  { id: "gray", label: "灰白", preview: "#f5f5f7" },
  { id: "slate", label: "青灰", preview: "#eef1f6" },
  { id: "charcoal", label: "炭黑", preview: "#ececec" },
  { id: "ink", label: "墨蓝", preview: "#eaeef4" },
  { id: "almond", label: "杏仁纸", preview: "#f7f1e7" },
  { id: "sage", label: "鼠尾草", preview: "#edf3ee" },
  { id: "mist", label: "雾蓝", preview: "#edf2f8" },
  { id: "lavender", label: "灰紫", preview: "#f1eef6" },
  { id: "graphite", label: "石墨", preview: "#efeff1" }
];

const LEGACY_SKIN_MAP = {
  midnight: "charcoal",
  mint: "green",
  dawn: "sand",
  ocean: "blue",
  dusk: "slate",
  aurora: "ink",
  rose: "sepia",
  lavender: "blue",
  graphite: "gray",
  sunset: "sand",
  forest: "green"
};

const THEME_COLORS = {
  paper: { light: "#6B5344", dark: "#1A1816" },
  snow: { light: "#8E8E93", dark: "#000000" },
  sepia: { light: "#8A7355", dark: "#2A2418" },
  green: { light: "#4A8A6A", dark: "#1A2420" },
  blue: { light: "#4A7BA7", dark: "#1A2228" },
  sand: { light: "#8A7355", dark: "#2A241C" },
  gray: { light: "#8E8E93", dark: "#2C2C2E" },
  slate: { light: "#5A6880", dark: "#1E2430" },
  charcoal: { light: "#636366", dark: "#1C1C1E" },
  ink: { light: "#3A5068", dark: "#121820" },
  almond: { light: "#8A6F4A", dark: "#2A2218" },
  sage: { light: "#4D7A60", dark: "#1B2620" },
  mist: { light: "#4D6F9A", dark: "#1A2330" },
  lavender: { light: "#6E628A", dark: "#241F30" },
  graphite: { light: "#5E6570", dark: "#15181E" }
};

export function normalizeSkinId(id) {
  if (SKINS.some((skin) => skin.id === id)) return id;
  return LEGACY_SKIN_MAP[id] || "paper";
}

export function getSkin(id) {
  const skinId = normalizeSkinId(id);
  return SKINS.find((skin) => skin.id === skinId) || SKINS[0];
}

export function applyAppearance(skinId, darkMode, root = document.documentElement) {
  const skin = getSkin(skinId);
  root.dataset.skin = skin.id;
  root.dataset.theme = darkMode ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const colors = THEME_COLORS[skin.id] || THEME_COLORS.paper;
    meta.content = darkMode ? colors.dark : colors.light;
  }
  return { skin, darkMode: Boolean(darkMode) };
}

