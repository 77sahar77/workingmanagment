// Pure data logic: no React, no DOM. Importable from node for tests.

export const STORAGE_KEY = "goals:v1";
export const LEGACY_KEY = "breakdown:v4";
export const INBOX_NAME = "ללא נושא";
export const INBOX_COLOR = "#B9BDB3";
const OLD_UNCATEGORIZED_NAME = "ללא קטגוריה";

// Palette matching the Time Blocking legend
export const PALETTE = [
  { name: "Tomato", hex: "#D6533F" },
  { name: "Flamingo", hex: "#DD8188" },
  { name: "Pumpkin", hex: "#E67E3B" },
  { name: "Banana", hex: "#F0C64B" },
  { name: "Pistachio", hex: "#8FAE5D" },
  { name: "Peacock", hex: "#5B8FC7" },
  { name: "Birch", hex: "#A69B8D" },
  { name: "Grape", hex: "#8E6FA8" },
];

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function emptySmart() {
  return { specific: "", measurable: "", achievable: "", relevant: "", timebound: "" };
}

export function emptyGoal() {
  return { goal: "", why: "", success: "", deadline: "", current: "", obstacle: "" };
}

export function newNode(title) {
  return { id: uid(), title, done: false, collapsed: false, smart: emptySmart(), children: [] };
}

export function newTopic(name, color, goal = {}) {
  return { id: uid(), name, color, inbox: false, goal: { ...emptyGoal(), ...goal }, tasks: [] };
}

// datetime-local input value, in the user's local time
export function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A master task holding the first small field action, due in 48 hours
export function firstActionTask(text, now = new Date()) {
  const child = newNode(text);
  child.smart = { ...emptySmart(), specific: text, timebound: toLocalInput(new Date(now.getTime() + 48 * 3600 * 1000)) };
  const master = newNode("הצעד הראשון");
  master.children = [child];
  return master;
}

// 0 = today, positive = days remaining, negative = overdue. null if no/invalid date.
export function daysLeft(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

// ---- recursive tree helpers ----
export function updateNode(nodes, id, updater) {
  return nodes.map((n) => {
    if (n.id === id) return updater(n);
    if (n.children?.length) return { ...n, children: updateNode(n.children, id, updater) };
    return n;
  });
}
export function addChildNode(nodes, parentId, child) {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, collapsed: false, children: [...n.children, child] };
    if (n.children?.length) return { ...n, children: addChildNode(n.children, parentId, child) };
    return n;
  });
}
export function removeNode(nodes, id) {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children?.length ? { ...n, children: removeNode(n.children, id) } : n));
}
export function collectLeaves(node) {
  if (!node.children || node.children.length === 0) return [node];
  return node.children.flatMap(collectLeaves);
}
export function nodeProgress(node) {
  const leaves = collectLeaves(node);
  const done = leaves.filter((l) => l.done).length;
  return { done, total: leaves.length };
}
// How many nodes sit below this one (children, grandchildren, ...)
export function countDescendants(node) {
  return (node.children || []).reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

// Flat, in-order list of the actionable steps under a master task.
// `path` = titles of the parents between the master task and the step (for context).
export function flattenLeaves(master) {
  const out = [];
  const walk = (nodes, path) => {
    for (const n of nodes) {
      if (!n.children || n.children.length === 0) out.push({ id: n.id, title: n.title, done: n.done, smart: n.smart, path });
      else walk(n.children, [...path, n.title]);
    }
  };
  walk(master.children || [], []);
  return out;
}

export function findFirstUndoneLeafId(nodes) {
  for (const n of nodes) {
    if (!n.children || n.children.length === 0) {
      if (!n.done) return n.id;
    } else {
      const found = findFirstUndoneLeafId(n.children);
      if (found) return found;
    }
  }
  return null;
}

// ---- normalization + migration ----
export function normalizeNode(n) {
  return {
    id: n.id || uid(),
    title: n.title || "",
    done: !!n.done,
    collapsed: !!n.collapsed,
    smart: { ...emptySmart(), ...(n.smart || {}) },
    children: Array.isArray(n.children) ? n.children.map(normalizeNode) : [],
    // completed pomodoro sessions (kept only on tasks that have any)
    ...(n.pomodoros > 0 ? { pomodoros: Math.round(n.pomodoros) } : {}),
  };
}

function normalizeTopic(t) {
  return {
    id: t.id || uid(),
    name: t.name || "נושא",
    color: t.color || PALETTE[0].hex,
    inbox: !!t.inbox,
    goal: { ...emptyGoal(), ...(t.goal || {}) },
    tasks: Array.isArray(t.tasks) ? t.tasks.map(normalizeNode) : [],
  };
}

export function looksLikeBackup(parsed) {
  return !!parsed && typeof parsed === "object" && (Array.isArray(parsed.topics) || Array.isArray(parsed.categories) || Array.isArray(parsed.tasks));
}

// Accepts: current format ({topics}), v4 ({categories, tasks}), or v3 ({tasks} only).
// Old categories become topics (no goal yet); their master tasks move inside.
export function migrate(parsed) {
  if (!looksLikeBackup(parsed)) return { topics: [], activeTopicId: null };

  if (Array.isArray(parsed.topics)) {
    return { topics: parsed.topics.map(normalizeTopic), activeTopicId: parsed.activeTopicId ?? null };
  }

  const cats = Array.isArray(parsed.categories) ? parsed.categories : [];
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  const topics = cats.map((c) => {
    const isInbox = c.name === OLD_UNCATEGORIZED_NAME || c.name === INBOX_NAME;
    return {
      id: c.id || uid(),
      name: isInbox ? INBOX_NAME : c.name || "נושא",
      color: c.color || INBOX_COLOR,
      inbox: isInbox,
      goal: emptyGoal(),
      tasks: [],
    };
  });

  let inbox = topics.find((t) => t.inbox);
  for (const task of tasks) {
    let target = topics.find((t) => t.id === task.categoryId);
    if (!target) {
      if (!inbox) {
        inbox = { id: uid(), name: INBOX_NAME, color: INBOX_COLOR, inbox: true, goal: emptyGoal(), tasks: [] };
        topics.push(inbox);
      }
      target = inbox;
    }
    target.tasks.push(normalizeNode(task));
  }

  const activeTopicId = topics.some((t) => t.id === parsed.activeCategoryId) ? parsed.activeCategoryId : null;
  return { topics, activeTopicId };
}
