// Pomodoro logic: pure functions, no React/DOM. Time is always passed in as `now` (ms),
// and a running timer stores its absolute end time, so it stays correct when the tab
// is throttled or the phone sleeps (we never count ticks).

export const SETTINGS_KEY = "goals:pomodoro:v1";
export const FOCUS_KEY = "goals:focus:v1";

export const MODES = ["focus", "short", "long"];
export const MODE_LABEL = { focus: "ריכוז", short: "הפסקה קצרה", long: "הפסקה ארוכה" };
export const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15, cycle: 4 };

export function clampMinutes(v, fallback = 25) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(1, n));
}

// focus sessions before a long break
export function clampCycle(v, fallback = DEFAULT_SETTINGS.cycle) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(2, n));
}

export function normalizeSettings(s) {
  const src = s && typeof s === "object" ? s : {};
  return {
    focus: clampMinutes(src.focus, DEFAULT_SETTINGS.focus),
    short: clampMinutes(src.short, DEFAULT_SETTINGS.short),
    long: clampMinutes(src.long, DEFAULT_SETTINGS.long),
    cycle: clampCycle(src.cycle),
  };
}

export function durationMs(mode, settings) {
  return settings[mode] * 60 * 1000;
}

// cycleCount = focus sessions finished in the current cycle (0..cycle)
export function initialTimer(settings) {
  return { mode: "focus", running: false, endAt: null, remainingMs: durationMs("focus", settings), cycleCount: 0 };
}

export function remaining(t, now) {
  return t.running ? Math.max(0, t.endAt - now) : t.remainingMs;
}

export function start(t, now) {
  if (t.running) return t;
  return { ...t, running: true, endAt: now + t.remainingMs };
}

export function pause(t, now) {
  if (!t.running) return t;
  return { ...t, running: false, endAt: null, remainingMs: Math.max(0, t.endAt - now) };
}

// Back to the full length of the current mode
export function reset(t, settings) {
  return { ...t, running: false, endAt: null, remainingMs: durationMs(t.mode, settings) };
}

function enter(t, mode, cycleCount, settings) {
  return { mode, running: false, endAt: null, remainingMs: durationMs(mode, settings), cycleCount };
}

// What follows a mode, given the cycle position. `completed` = the session ran to the end.
function successor(t, settings, completed) {
  if (t.mode === "focus") {
    const count = completed ? t.cycleCount + 1 : t.cycleCount;
    if (completed && count >= settings.cycle) return enter(t, "long", count, settings);
    return enter(t, "short", count, settings);
  }
  // after any break a new cycle step begins; after the long break the cycle restarts
  return enter(t, "focus", t.mode === "long" ? 0 : t.cycleCount, settings);
}

// If a running timer reached its end: returns the next mode (paused) and which mode finished.
export function tick(t, settings, now) {
  if (t.running && now >= t.endAt) return { timer: successor(t, settings, true), finished: t.mode };
  return { timer: t, finished: null };
}

// Skip to the next mode. Skipping a focus session does not count it as completed.
export function skip(t, settings) {
  return successor(t, settings, false);
}

export function setMode(t, mode, settings) {
  if (!MODES.includes(mode) || mode === t.mode) return t;
  return enter(t, mode, mode === "focus" && t.mode === "long" ? 0 : t.cycleCount, settings);
}

// New settings: a paused timer picks up the new length for its current mode
export function applySettings(t, settings) {
  if (t.running) return t;
  return { ...t, remainingMs: durationMs(t.mode, settings) };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---- persistence helpers (safe when storage is blocked) ----
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

// A focus session = which task is being worked on + its timer. Survives a page reload.
export function loadFocus(settings) {
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw);
    if (!f || typeof f.taskId !== "string" || typeof f.topicId !== "string" || !f.timer) return null;
    const t = f.timer;
    if (!MODES.includes(t.mode)) return null;
    const timer = {
      mode: t.mode,
      running: !!t.running && Number.isFinite(t.endAt),
      endAt: Number.isFinite(t.endAt) ? t.endAt : null,
      remainingMs: Number.isFinite(t.remainingMs) ? Math.max(0, t.remainingMs) : durationMs(t.mode, settings),
      cycleCount: Math.max(0, Math.min(settings.cycle, Math.round(Number(t.cycleCount)) || 0)),
    };
    return { topicId: f.topicId, taskId: f.taskId, timer };
  } catch {
    return null;
  }
}

export function saveFocus(focus) {
  try {
    if (focus) localStorage.setItem(FOCUS_KEY, JSON.stringify(focus));
    else localStorage.removeItem(FOCUS_KEY);
  } catch {
    /* ignore */
  }
}
