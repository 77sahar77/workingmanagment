import { useState, useEffect, useRef } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Check, Target, X, Split,
  Download, Upload, Settings, FolderInput, Pencil, Play, Timer,
} from "lucide-react";
import {
  STORAGE_KEY, LEGACY_KEY, PALETTE, INBOX_NAME,
  emptyGoal, newNode, newTopic, firstActionTask, daysLeft, emptySmart,
  updateNode, addChildNode, removeNode, nodeProgress, findFirstUndoneLeafId,
  migrate, looksLikeBackup, countDescendants,
} from "./model.js";
import { COLORS } from "./theme.js";
import { APP_NAME, APP_TAGLINE } from "./brand.js";
import FocusPage, { MinutesField } from "./Focus.jsx";
import { playAlert, unlockAudio } from "./alert.js";
import { isNative, scheduleTimerEnd, cancelTimerEnd, shareBackup } from "./native.js";
import {
  FOCUS_KEY, MODE_LABEL, initialTimer, loadFocus, saveFocus, loadSettings, saveSettings, normalizeSettings,
  start as timerStart, pause as timerPause, reset as timerReset, skip as timerSkip, setMode as timerSetMode,
  applySettings, tick as timerTick, remaining as timerRemaining, formatClock,
} from "./pomodoro.js";

const SMART_FIELDS = [
  { key: "specific", label: "ספציפי", hint: "מה בדיוק צריך לעשות?" },
  { key: "measurable", label: "מדיד", hint: "איך תדע שזה בוצע?" },
  { key: "achievable", label: "בר השגה", hint: "זה ריאלי בזמן/במשאבים שיש לך?" },
  { key: "relevant", label: "רלוונטי", hint: "למה זה קשור למשימה שמעליו?" },
];

const GOAL_FIELDS = [
  { key: "goal", label: "המטרה" },
  { key: "why", label: "למה זה חשוב לי עכשיו" },
  { key: "success", label: "איך אדע שהשגתי" },
  { key: "deadline", label: "עד מתי", type: "date" },
  { key: "current", label: "המצב היום" },
  { key: "obstacle", label: "מה הכי עלול לעצור אותי" },
];

// Intake questionnaire — one question per screen
const STEPS = [
  { key: "goal", q: "מה המטרה שלך בנושא הזה?", hint: "משפט אחד, כמה שיותר ברור. מה יהיה נכון בסוף שלא נכון היום?", type: "textarea", required: true },
  { key: "why", q: "למה זה חשוב לך עכשיו?", hint: "הסיבה האמיתית. זה מה שיחזיק אותך ביום שלא בא לך.", type: "textarea" },
  { key: "success", q: "איך תדע שהשגת אותה?", hint: "מספר, תוצאה או משהו שאפשר לראות. למשל: \"שלוש הרצאות שנמכרו\" ולא \"להתקדם\".", type: "textarea" },
  { key: "deadline", q: "עד מתי?", hint: "תאריך יעד. מטרה בלי תאריך היא משאלה.", type: "date" },
  { key: "current", q: "מה המצב היום?", hint: "נקודת הפתיחה: מה כבר קיים ומה חסר.", type: "textarea" },
  { key: "obstacle", q: "מה הדבר שהכי עלול לעצור אותך?", hint: "לא תירוץ. החסם הכי סביר.", type: "textarea" },
  { key: "firstAction", q: "מה הפעולה הראשונה והקטנה שתעשה ב-48 השעות הקרובות?", hint: "משהו שאפשר לבצע בשטח, לא לתכנן. היא תיכנס כמשימה ראשונה עם דדליין של 48 שעות.", type: "textarea" },
];

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.error("load failed", e);
  }
  return { topics: [], activeTopicId: null };
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

// ---------- small shared bits ----------

function Deadline({ iso }) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const overdue = d < new Date();
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full shrink-0"
      style={{ background: overdue ? "#F6DCD5" : COLORS.warmSoft, color: overdue ? COLORS.danger : COLORS.warm }}
    >
      {d.toLocaleDateString("he-IL", { day: "numeric", month: "short" })} · {d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function GoalDeadlineChip({ dateStr }) {
  const n = daysLeft(dateStr);
  if (n === null) return null;
  const overdue = n < 0;
  const label = overdue ? `עבר המועד (${Math.abs(n)} ימים)` : n === 0 ? "היום" : n === 1 ? "מחר" : `עוד ${n} ימים`;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full shrink-0"
      style={{ background: overdue ? "#F6DCD5" : COLORS.warmSoft, color: overdue ? COLORS.danger : COLORS.warm }}
    >
      {label}
    </span>
  );
}

function SmartPanel({ smart, onChange }) {
  return (
    <div className="mt-2 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
      {SMART_FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-xs font-semibold" style={{ color: COLORS.accent }}>{f.label}</label>
          <input
            type="text"
            value={smart[f.key]}
            placeholder={f.hint}
            onChange={(e) => onChange({ ...smart, [f.key]: e.target.value })}
            className="text-sm rounded-md px-2 py-1.5 outline-none"
            style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold" style={{ color: COLORS.accent }}>תחום בזמן</label>
        <input
          type="datetime-local"
          value={smart.timebound}
          onChange={(e) => onChange({ ...smart, timebound: e.target.value })}
          className="text-sm rounded-md px-2 py-1.5 outline-none"
          style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
        />
      </div>
    </div>
  );
}

// Inline "are you sure" box used before anything is deleted
function DeleteConfirm({ message, onConfirm, onCancel }) {
  return (
    <div role="alertdialog" aria-label="אימות מחיקה" className="rounded-md p-2.5 flex flex-col gap-2 mt-2" style={{ background: "#F6DCD5" }}>
      <p className="text-xs" style={{ color: COLORS.danger }}>{message}</p>
      <div className="flex gap-2">
        <button onClick={onConfirm} className="rounded-md px-2.5 py-1 text-xs font-medium" style={{ background: COLORS.danger, color: "#fff" }}>מחק</button>
        <button onClick={onCancel} className="rounded-md px-2.5 py-1 text-xs" style={{ background: COLORS.surface, color: COLORS.text }}>ביטול</button>
      </div>
    </div>
  );
}

function deleteMessage(kind, node) {
  const n = countDescendants(node);
  const inside = n === 0 ? "" : ` ועוד ${n} צעדים שבתוכ${kind === "משימה" ? "ה" : "ו"}`;
  return `למחוק את ${kind === "משימה" ? "המשימה" : "הצעד"} "${node.title}"${inside}? אי אפשר לשחזר, חוץ מקובץ גיבוי.`;
}

// ---------- task tree (SMART) ----------

function TreeNode({ node, depth, nextLeafId, onToggleDone, onUpdateSmart, onAddChild, onDelete, onToggleCollapse }) {
  const [smartOpen, setSmartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [childText, setChildText] = useState("");

  const isParent = node.children.length > 0;
  const isNext = node.id === nextLeafId;
  const { done, total } = isParent ? nodeProgress(node) : { done: 0, total: 0 };
  const hasSmart = Object.values(node.smart).some((v) => v);

  function submitChild() {
    const title = childText.trim();
    if (!title) return;
    onAddChild(node.id, newNode(title));
    setChildText("");
    setAddOpen(false);
  }

  return (
    <div style={{ paddingInlineStart: depth > 0 ? 20 : 0, borderInlineStart: depth > 0 ? `2px solid ${COLORS.border}` : "none" }}>
      <div
        className="rounded-xl p-3 mb-2 transition-all"
        style={{
          background: isNext ? COLORS.accentSoft : COLORS.surface,
          border: `1px solid ${isNext ? COLORS.accent : COLORS.border}`,
          marginInlineStart: depth > 0 ? 10 : 0,
        }}
      >
        <div className="flex items-start gap-2">
          {isParent ? (
            <button onClick={() => onToggleCollapse(node.id)} className="mt-0.5 shrink-0" style={{ color: COLORS.textSoft }}>
              {node.collapsed ? <ChevronLeft size={18} /> : <ChevronDown size={18} />}
            </button>
          ) : (
            <button
              onClick={() => onToggleDone(node.id)}
              className="mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: node.done ? COLORS.accent : "transparent", border: `2px solid ${node.done ? COLORS.accent : COLORS.textSoft}` }}
            >
              {node.done && <Check size={14} color="#fff" />}
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isNext && !node.done && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: COLORS.accent, color: "#fff" }}>
                  הצעד הבא
                </span>
              )}
              <p
                className="text-sm leading-snug"
                style={{ color: node.done ? COLORS.textSoft : COLORS.text, textDecoration: node.done ? "line-through" : "none", fontWeight: isParent ? 600 : 400 }}
              >
                {node.title}
              </p>
            </div>

            {isParent && total > 0 && (
              <div className="mt-1.5 max-w-xs">
                <div className="flex justify-between text-[11px] mb-0.5" style={{ color: COLORS.textSoft }}>
                  <span>{done}/{total} צעדים</span>
                  <span style={{ color: COLORS.accent, fontWeight: 600 }}>{Math.round((done / total) * 100)}%</span>
                </div>
                <div className="h-1 rounded-full w-full" style={{ background: COLORS.border }}>
                  <div className="h-1 rounded-full" style={{ width: `${(done / total) * 100}%`, background: COLORS.accent }} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Deadline iso={node.smart.timebound} />
              <button onClick={() => setSmartOpen((o) => !o)} className="text-xs flex items-center gap-1" style={{ color: hasSmart ? COLORS.accent : COLORS.textSoft }}>
                <Target size={12} />
                {hasSmart ? "פרטי SMART" : "הגדר SMART"}
              </button>
              <button onClick={() => setAddOpen((o) => !o)} className="text-xs flex items-center gap-1" style={{ color: COLORS.warm }}>
                <Split size={12} />
                פרק לתתי-משימות
              </button>
            </div>

            {smartOpen && <SmartPanel smart={node.smart} onChange={(s) => onUpdateSmart(node.id, s)} />}

            {addOpen && (
              <div className="flex gap-2 mt-2">
                <input
                  autoFocus
                  value={childText}
                  onChange={(e) => setChildText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitChild()}
                  placeholder="תת-משימה חדשה..."
                  className="flex-1 text-sm rounded-md px-2 py-1.5 outline-none"
                  style={{ border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text }}
                />
                <button onClick={submitChild} className="rounded-md px-2.5 text-sm font-medium" style={{ background: COLORS.warm, color: "#fff" }}>
                  הוסף
                </button>
              </div>
            )}

            {confirmDelete && (
              <DeleteConfirm
                message={deleteMessage("צעד", node)}
                onConfirm={() => { setConfirmDelete(false); onDelete(node.id); }}
                onCancel={() => setConfirmDelete(false)}
              />
            )}
          </div>

          <button onClick={() => setConfirmDelete((c) => !c)} className="shrink-0 opacity-50 hover:opacity-100" style={{ color: COLORS.danger }} aria-label="מחק צעד">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {isParent && !node.collapsed && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              nextLeafId={nextLeafId}
              onToggleDone={onToggleDone}
              onUpdateSmart={onUpdateSmart}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- master tasks strip ----------

function MasterTaskCard({ task, color, isActive, onClick, onMoveEarlier, onMoveLater, disableEarlier, disableLater, showMove, moveTargets, onRecategorize }) {
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const p = nodeProgress(task);
  const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);
  return (
    <div
      style={{
        scrollSnapAlign: "start",
        background: `${color}33`,
        border: `2px solid ${isActive ? color : "transparent"}`,
        boxShadow: isActive ? `0 2px 8px ${color}55` : "0 1px 3px rgba(0,0,0,0.05)",
        position: "relative",
      }}
      className="shrink-0 w-40 rounded-2xl p-3 flex flex-col gap-1.5 transition-all"
    >
      <div className="flex items-start justify-between gap-1">
        <button onClick={onClick} className="flex-1 text-right min-w-0">
          <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: COLORS.text }}>{task.title}</p>
        </button>
        <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
          {showMove && (
            <button
              onClick={() => setMovePopoverOpen((o) => !o)}
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.7)" }}
              aria-label="העבר לנושא"
            >
              <FolderInput size={11} style={{ color: COLORS.text }} />
            </button>
          )}
          <button onClick={onMoveEarlier} disabled={disableEarlier} className="w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-25" style={{ background: "rgba(255,255,255,0.7)" }} aria-label="הזז קודם">
            <ChevronRight size={11} style={{ color: COLORS.text }} />
          </button>
          <button onClick={onMoveLater} disabled={disableLater} className="w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-25" style={{ background: "rgba(255,255,255,0.7)" }} aria-label="הזז אחר כך">
            <ChevronLeft size={11} style={{ color: COLORS.text }} />
          </button>
        </div>
      </div>

      {movePopoverOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-8 left-2 z-20 rounded-xl p-2 flex flex-wrap gap-1.5 w-32"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}
        >
          {moveTargets.map((c) => (
            <button
              key={c.id}
              onClick={() => { onRecategorize(task.id, c.id); setMovePopoverOpen(false); }}
              className="w-6 h-6 rounded-full"
              style={{ background: c.color }}
              title={c.name}
              aria-label={c.name}
            />
          ))}
          {moveTargets.length === 0 && <span className="text-[11px]" style={{ color: COLORS.textSoft }}>אין נושאים אחרים</span>}
        </div>
      )}

      <button onClick={onClick} className="text-right flex flex-col gap-1">
        <div className="flex justify-between text-[11px]" style={{ color: COLORS.textSoft }}>
          <span>{p.total === 0 ? "אין פירוק" : `${p.done}/${p.total}`}</span>
          {p.total > 0 && <span style={{ fontWeight: 700, color: COLORS.text }}>{pct}%</span>}
        </div>
        <div className="h-1.5 rounded-full w-full" style={{ background: "rgba(255,255,255,0.7)" }}>
          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      </button>
    </div>
  );
}

function MasterTaskStrip({ scrollerRef, tasks, color, activeId, onSelect, onAdd, onMove, onScrollBy, showMove, moveTargets, onRecategorize }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  function submit() {
    const t = title.trim();
    if (!t) return;
    onAdd(t);
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <button onClick={() => onScrollBy(1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <ChevronLeft size={15} style={{ color: COLORS.text }} />
        </button>
        <button onClick={() => onScrollBy(-1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <ChevronRight size={15} style={{ color: COLORS.text }} />
        </button>
      </div>
      <div ref={scrollerRef} className="flex gap-2.5 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
        {tasks.map((t, i) => (
          <MasterTaskCard
            key={t.id}
            task={t}
            color={color}
            isActive={t.id === activeId}
            onClick={() => onSelect(t.id)}
            onMoveEarlier={() => onMove(t.id, -1)}
            onMoveLater={() => onMove(t.id, 1)}
            disableEarlier={i === 0}
            disableLater={i === tasks.length - 1}
            showMove={showMove}
            moveTargets={moveTargets}
            onRecategorize={onRecategorize}
          />
        ))}
        {!adding ? (
          <button onClick={() => setAdding(true)} className="shrink-0 w-40 rounded-2xl p-3.5 flex flex-col items-center justify-center gap-1" style={{ border: `2px dashed ${COLORS.border}`, color: COLORS.textSoft, minHeight: 84 }}>
            <Plus size={18} />
            <span className="text-xs">משימה חדשה בנושא</span>
          </button>
        ) : (
          <div className="shrink-0 w-48 rounded-2xl p-3 flex flex-col gap-2" style={{ background: COLORS.surface, border: `1px solid ${color}` }}>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="שם המשימה..."
              className="text-sm rounded-md px-2 py-1.5 outline-none"
              style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}
            />
            <div className="flex gap-1.5">
              <button onClick={submit} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: color, color: "#fff" }}>הוסף</button>
              <button onClick={() => { setAdding(false); setTitle(""); }} className="rounded-md px-2.5 py-1.5" style={{ border: `1px solid ${COLORS.border}` }}><X size={13} /></button>
            </div>
          </div>
        )}
      </div>
      {tasks.length === 0 && <p className="text-xs" style={{ color: COLORS.textSoft }}>אין עדיין משימות בנושא הזה.</p>}
    </div>
  );
}

// ---------- topic tabs ----------

function TopicTab({ topic, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 flex items-center gap-2 rounded-full px-3.5 py-2 transition-all"
      style={{
        background: isActive ? topic.color : COLORS.surface,
        border: `1.5px solid ${isActive ? topic.color : COLORS.border}`,
      }}
    >
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: isActive ? "#fff" : topic.color }} />
      <span className="text-sm font-medium" style={{ color: isActive ? "#fff" : COLORS.text }}>{topic.name}</span>
    </button>
  );
}

// ---------- goal card ----------

export function GoalCard({ topic, onSave, onDefine }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.goal);
  const g = topic.goal;
  const hasGoal = g.goal.trim().length > 0;

  useEffect(() => {
    setExpanded(false);
    setEditing(false);
  }, [topic.id]);

  function startEdit() {
    setDraft({ ...g });
    setExpanded(true);
    setEditing(true);
  }
  function save() {
    onSave({ ...draft, goal: draft.goal.trim() });
    setEditing(false);
  }

  if (!hasGoal && !editing) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ border: `2px dashed ${topic.color}`, background: `${topic.color}14` }}>
        <p className="text-sm" style={{ color: COLORS.text }}>לנושא הזה עוד אין מטרה ברורה.</p>
        <button onClick={onDefine} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: topic.color, color: "#fff" }}>
          הגדר מטרה
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: `${topic.color}1F`, borderInlineStart: `5px solid ${topic.color}` }}>
      {!editing ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold mb-0.5" style={{ color: COLORS.textSoft }}>המטרה</p>
              <p className={`text-base font-bold leading-snug ${expanded ? "" : "line-clamp-2"}`} style={{ color: COLORS.text }}>{g.goal}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <GoalDeadlineChip dateStr={g.deadline} />
              <button onClick={startEdit} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.8)" }} aria-label="ערוך מטרה">
                <Pencil size={13} style={{ color: COLORS.text }} />
              </button>
              <button onClick={() => setExpanded((e) => !e)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.8)" }} aria-label={expanded ? "צמצם" : "קרא במלואה"}>
                {expanded ? <ChevronUp size={15} style={{ color: COLORS.text }} /> : <ChevronDown size={15} style={{ color: COLORS.text }} />}
              </button>
            </div>
          </div>

          {expanded && (
            <dl className="flex flex-col gap-2.5 pt-1">
              {GOAL_FIELDS.filter((f) => f.key !== "goal").map((f) => {
                const v = g[f.key];
                return (
                  <div key={f.key}>
                    <dt className="text-[11px] font-semibold" style={{ color: COLORS.textSoft }}>{f.label}</dt>
                    <dd className="text-sm whitespace-pre-wrap" style={{ color: v ? COLORS.text : COLORS.textSoft }}>
                      {v ? (f.type === "date" ? formatDate(v) : v) : "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {GOAL_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: COLORS.accent }}>{f.label}</label>
              {f.type === "date" ? (
                <input
                  type="date"
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  className="text-sm rounded-md px-2 py-1.5 outline-none w-fit"
                  style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
                />
              ) : (
                <textarea
                  rows={f.key === "goal" ? 2 : 2}
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  className="text-sm rounded-md px-2 py-1.5 outline-none resize-y"
                  style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={save} disabled={!draft.goal.trim()} className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40" style={{ background: COLORS.accent, color: "#fff" }}>
              שמור
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-sm" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- intake wizard ----------

export function Wizard({ askName, initial, onCancel, onFinish }) {
  const [name, setName] = useState(initial.name || "");
  const [color, setColor] = useState(initial.color || PALETTE[0].hex);
  const [answers, setAnswers] = useState({ ...emptyGoal(), firstAction: "", ...(initial.goal || {}) });
  const [step, setStep] = useState(0);

  const offset = askName ? 1 : 0;
  const total = STEPS.length + offset;
  const isNameStep = askName && step === 0;
  const def = isNameStep ? null : STEPS[step - offset];
  const isLast = step === total - 1;
  const value = isNameStep ? name : answers[def.key] || "";
  const canNext = isNameStep ? name.trim().length > 0 : def.required ? value.trim().length > 0 : true;

  function finish() {
    const { firstAction, ...goal } = answers;
    const cleaned = Object.fromEntries(Object.entries(goal).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    onFinish({ name: name.trim(), color, goal: cleaned, firstAction: (firstAction || "").trim() });
  }
  function next() {
    if (!canNext) return;
    if (isLast) finish();
    else setStep((s) => s + 1);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,48,44,0.45)" }}>
      <div dir="rtl" className="w-full sm:w-[460px] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-4" style={{ background: COLORS.surface }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: COLORS.textSoft }}>שאלה {step + 1} מתוך {total}</span>
          <button onClick={onCancel} style={{ color: COLORS.textSoft }} aria-label="סגור"><X size={18} /></button>
        </div>
        <div className="h-1 rounded-full w-full" style={{ background: COLORS.border }}>
          <div className="h-1 rounded-full transition-all" style={{ width: `${((step + 1) / total) * 100}%`, background: COLORS.accent }} />
        </div>

        {isNameStep ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-bold" style={{ color: COLORS.text }}>איך קוראים לנושא?</h3>
            <p className="text-sm" style={{ color: COLORS.textSoft }}>זה יהיה שם הטאב. בחר גם צבע.</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="למשל: עסק, בריאות, משפחה..."
              className="text-sm rounded-md px-3 py-2 outline-none"
              style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}
            />
            <div className="flex flex-wrap gap-2.5">
              {PALETTE.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setColor(c.hex)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: c.hex, border: color === c.hex ? `2.5px solid ${COLORS.text}` : "2.5px solid transparent" }}
                  title={c.name}
                  aria-label={c.name}
                >
                  {color === c.hex && <Check size={14} color="#fff" />}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-bold leading-snug" style={{ color: COLORS.text }}>{def.q}</h3>
            <p className="text-sm" style={{ color: COLORS.textSoft }}>{def.hint}</p>
            {def.type === "date" ? (
              <input
                type="date"
                value={value}
                onChange={(e) => setAnswers({ ...answers, [def.key]: e.target.value })}
                className="text-sm rounded-md px-3 py-2 outline-none w-fit"
                style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}
              />
            ) : (
              <textarea
                autoFocus
                rows={3}
                value={value}
                onChange={(e) => setAnswers({ ...answers, [def.key]: e.target.value })}
                className="text-sm rounded-md px-3 py-2 outline-none resize-y"
                style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm rounded-md px-3 py-2 disabled:opacity-30"
            style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}
          >
            חזרה
          </button>
          <button
            onClick={next}
            disabled={!canNext}
            className="text-sm font-medium rounded-md px-4 py-2 disabled:opacity-40"
            style={{ background: COLORS.accent, color: "#fff" }}
          >
            {isLast ? (askName ? "צור את הטאב" : "שמור מטרה") : !isNameStep && !def.required && !value.trim() ? "דלג" : "הבא"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- settings ----------

export function SettingsModal({ topics, timerSettings, onTimerSettings, onNewTopic, onDelete, onMove, onExport, onReset, onClose }) {
  const [confirmId, setConfirmId] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,48,44,0.4)" }} onClick={onClose}>
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[420px] max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: COLORS.surface }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: COLORS.text }}>הגדרות</h3>
          <button onClick={onClose} style={{ color: COLORS.textSoft }} aria-label="סגור"><X size={18} /></button>
        </div>

        <h4 className="text-sm font-semibold -mb-2" style={{ color: COLORS.text }}>נושאים</h4>
        <div className="flex flex-col gap-2">
          {topics.map((t, i) => (
            <div key={t.id} className="rounded-lg p-2.5 flex flex-col gap-2" style={{ background: COLORS.bg }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="text-sm truncate" style={{ color: COLORS.text }}>{t.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onMove(t.id, -1)} disabled={i === 0} className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} aria-label="הזז למעלה">
                    <ChevronUp size={13} style={{ color: COLORS.text }} />
                  </button>
                  <button onClick={() => onMove(t.id, 1)} disabled={i === topics.length - 1} className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} aria-label="הזז למטה">
                    <ChevronDown size={13} style={{ color: COLORS.text }} />
                  </button>
                  <button onClick={() => setConfirmId(confirmId === t.id ? null : t.id)} className="mr-1" style={{ color: COLORS.danger }} aria-label="מחק נושא">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {confirmId === t.id && (
                <div className="rounded-md p-2 flex flex-col gap-2" style={{ background: "#F6DCD5" }}>
                  <p className="text-xs" style={{ color: COLORS.danger }}>
                    למחוק את הנושא "{t.name}" עם המטרה שלו ({t.tasks.length} משימות, {t.tasks.reduce((s, x) => s + countDescendants(x), 0)} צעדים)? אי אפשר לשחזר, חוץ מקובץ גיבוי.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => { onDelete(t.id); setConfirmId(null); }} className="rounded-md px-2.5 py-1 text-xs font-medium" style={{ background: COLORS.danger, color: "#fff" }}>מחק</button>
                    <button onClick={() => setConfirmId(null)} className="rounded-md px-2.5 py-1 text-xs" style={{ background: COLORS.surface, color: COLORS.text }}>ביטול</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {topics.length === 0 && <p className="text-sm" style={{ color: COLORS.textSoft }}>אין עדיין נושאים.</p>}
        </div>

        <button onClick={onNewTopic} className="rounded-md py-2.5 text-sm font-medium flex items-center justify-center gap-1.5" style={{ background: COLORS.accent, color: "#fff" }}>
          <Plus size={15} /> נושא חדש (עם שאלון מטרה)
        </button>

        <div className="pt-3 flex flex-col gap-3" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <h4 className="text-sm font-semibold" style={{ color: COLORS.text }}>טיימר פומודורו</h4>
          <div className="grid grid-cols-2 gap-3">
            <MinutesField label="זמן עבודה (דקות)" value={timerSettings.focus} onCommit={(n) => onTimerSettings({ ...timerSettings, focus: n })} />
            <MinutesField label="הפסקה קצרה (דקות)" value={timerSettings.short} onCommit={(n) => onTimerSettings({ ...timerSettings, short: n })} />
            <MinutesField label="הפסקה ארוכה (דקות)" value={timerSettings.long} onCommit={(n) => onTimerSettings({ ...timerSettings, long: n })} />
            <MinutesField label="סבבי עבודה עד הפסקה ארוכה" value={timerSettings.cycle} min={2} max={8} onCommit={(n) => onTimerSettings({ ...timerSettings, cycle: n })} />
          </div>
          <p className="text-xs" style={{ color: COLORS.textSoft }}>טיימר שכבר רץ ממשיך עד הסוף. השינוי חל מהסבב הבא.</p>
        </div>

        <div className="pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {!resetOpen ? (
            <button onClick={() => setResetOpen(true)} className="text-xs self-start" style={{ color: COLORS.danger }}>
              אפס את כל הנתונים
            </button>
          ) : (
            <div className="rounded-md p-3 flex flex-col gap-2.5" style={{ background: "#F6DCD5" }}>
              <p className="text-sm font-semibold" style={{ color: COLORS.danger }}>לאפס את כל הנתונים?</p>
              <p className="text-xs" style={{ color: COLORS.danger }}>
                זה מוחק את כל הנושאים, המטרות והמשימות, גם את מה שנשמר מהגרסאות הקודמות. אי אפשר לשחזר, חוץ מקובץ גיבוי.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={onExport} className="rounded-md px-2.5 py-1.5 text-xs font-medium flex items-center gap-1" style={{ background: COLORS.surface, color: COLORS.text }}>
                  <Download size={12} /> הורד גיבוי קודם
                </button>
                <button onClick={onReset} className="rounded-md px-2.5 py-1.5 text-xs font-medium" style={{ background: COLORS.danger, color: "#fff" }}>
                  מחק הכול
                </button>
                <button onClick={() => setResetOpen(false)} className="rounded-md px-2.5 py-1.5 text-xs" style={{ background: COLORS.surface, color: COLORS.text }}>
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- app ----------

export default function App() {
  const [topics, setTopics] = useState(() => loadInitial().topics);
  const [activeTopicId, setActiveTopicId] = useState(() => loadInitial().activeTopicId);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [newChildTitle, setNewChildTitle] = useState("");
  const [confirmMasterId, setConfirmMasterId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wizard, setWizard] = useState(null); // { mode: "new" } | { mode: "goal", topicId }
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef(null);
  const scrollerRef = useRef(null);

  // ----- focus session (work on one task + pomodoro timer) -----
  const [pSettings, setPSettings] = useState(loadSettings);
  const [focus, setFocus] = useState(() => loadFocus(loadSettings())); // { topicId, taskId, timer } | null
  const [focusOpen, setFocusOpen] = useState(() => !!loadFocus(loadSettings()));
  const focusRef = useRef(focus);
  const settingsRef = useRef(pSettings);
  const checkRef = useRef(null);
  focusRef.current = focus;
  settingsRef.current = pSettings;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 5, topics, activeTopicId }));
    } catch (e) {
      console.error("save failed", e);
    }
  }, [topics, activeTopicId]);

  useEffect(() => {
    saveFocus(focus);
  }, [focus]);

  // a pending delete confirmation belongs to the task it was opened on
  useEffect(() => {
    setConfirmMasterId(null);
  }, [activeTaskId, activeTopicId]);

  // The task being worked on must still exist (it may be gone after a restore/reset)
  const focusTopic = focus ? topics.find((t) => t.id === focus.topicId) || null : null;
  const focusTask = focusTopic ? focusTopic.tasks.find((t) => t.id === focus.taskId) || null : null;
  useEffect(() => {
    if (focus && !focusTask) {
      setFocus(null);
      setFocusOpen(false);
    }
  }, [focus, focusTask]);

  // Finish detection: by wall-clock time, so a sleeping phone or throttled tab can't drift
  checkRef.current = function checkTimer() {
    const f = focusRef.current;
    if (!f || !f.timer.running) return;
    const now = Date.now();
    const { timer, finished } = timerTick(f.timer, settingsRef.current, now);
    if (!finished) return;
    const next = { ...f, timer };
    focusRef.current = next; // synchronous, so a second check can't count the same session twice
    setFocus(next);
    if (finished === "focus") creditPomodoro(f.topicId, f.taskId);
    if (now - f.timer.endAt < 8000) {
      playAlert();
      setNotice(finished === "focus" ? "סבב הריכוז הסתיים. זמן להפסקה." : "ההפסקה הסתיימה. מוכן לסבב הבא?");
    }
  };
  const timerRunning = !!focus?.timer.running;
  useEffect(() => {
    checkRef.current();
    if (!timerRunning) return;
    const id = setInterval(() => checkRef.current(), 400);
    const onVis = () => { if (document.visibilityState === "visible") checkRef.current(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [timerRunning]);

  function creditPomodoro(topicId, taskId) {
    setTopics((prev) =>
      prev.map((t) =>
        t.id !== topicId ? t : { ...t, tasks: t.tasks.map((x) => (x.id === taskId ? { ...x, pomodoros: (x.pomodoros || 0) + 1 } : x)) }
      )
    );
  }
  function openFocus(topicId, taskId) {
    // the timer belongs to the person, not the task: switching tasks keeps it running
    const timer = focusRef.current?.timer ?? initialTimer(settingsRef.current);
    const next = { topicId, taskId, timer };
    focusRef.current = next;
    setFocus(next);
    setFocusOpen(true);
  }
  function closeFocus() {
    setFocusOpen(false);
    if (!focusRef.current?.timer.running) {
      focusRef.current = null;
      setFocus(null);
    }
  }
  function focusAction(a) {
    const f = focusRef.current;
    if (!f) return;
    const now = Date.now();
    const s = settingsRef.current;
    let timer = f.timer;
    if (a.type === "start") {
      unlockAudio();
      timer = timerStart(timer, now);
    } else if (a.type === "pause") timer = timerPause(timer, now);
    else if (a.type === "reset") timer = timerReset(timer, s);
    else if (a.type === "skip") timer = timerSkip(timer, s);
    else if (a.type === "mode") timer = timerSetMode(timer, a.mode, s);
    const next = { ...f, timer };
    focusRef.current = next;
    setFocus(next);
  }
  // A native notification at the exact end of a running timer (works with the app closed)
  const tRun = focus?.timer.running, tEnd = focus?.timer.endAt, tMode = focus?.timer.mode;
  useEffect(() => {
    if (tRun && tEnd) scheduleTimerEnd(tEnd, tMode);
    else cancelTimerEnd();
  }, [tRun, tEnd, tMode]);

  function changeTimerSettings(raw) {
    const s = normalizeSettings(raw);
    settingsRef.current = s;
    setPSettings(s);
    saveSettings(s);
    const f = focusRef.current;
    if (f) {
      const next = { ...f, timer: applySettings(f.timer, s) };
      focusRef.current = next;
      setFocus(next);
    }
  }
  function updateFocusTasks(fn) {
    const f = focusRef.current;
    if (!f) return;
    setTopics((prev) => prev.map((t) => (t.id === f.topicId ? { ...t, tasks: fn(t.tasks) } : t)));
  }
  const focusToggleStep = (id) => updateFocusTasks((tasks) => updateNode(tasks, id, (n) => ({ ...n, done: !n.done })));
  const focusAddStep = (title) => {
    const f = focusRef.current;
    if (f) updateFocusTasks((tasks) => addChildNode(tasks, f.taskId, newNode(title)));
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // The inbox topic (migrated, uncategorized tasks) hides itself once empty
  const visibleTopics = topics.filter((t) => !(t.inbox && t.tasks.length === 0));
  const activeTopic = visibleTopics.find((t) => t.id === activeTopicId) || visibleTopics[0] || null;
  const activeTask = activeTopic ? activeTopic.tasks.find((t) => t.id === activeTaskId) || null : null;

  function updateTopic(id, fn) {
    setTopics((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }
  function updateActiveTasks(fn) {
    if (!activeTopic) return;
    updateTopic(activeTopic.id, (t) => ({ ...t, tasks: fn(t.tasks) }));
  }

  function selectTopic(id) {
    setActiveTopicId(id);
    setActiveTaskId(null);
  }

  // ----- topics -----
  function finishWizard(result) {
    if (wizard?.mode === "goal") {
      updateTopic(wizard.topicId, (t) => ({
        ...t,
        goal: { ...t.goal, ...result.goal },
        tasks: result.firstAction ? [...t.tasks, firstActionTask(result.firstAction)] : t.tasks,
      }));
      setActiveTopicId(wizard.topicId);
      setActiveTaskId(null);
    } else {
      const t = newTopic(result.name, result.color, result.goal);
      let focus = null;
      if (result.firstAction) {
        const master = firstActionTask(result.firstAction);
        t.tasks.push(master);
        focus = master.id;
      }
      setTopics((prev) => [...prev, t]);
      setActiveTopicId(t.id);
      setActiveTaskId(focus);
    }
    setWizard(null);
  }
  function moveTopic(id, dir) {
    setTopics((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const newIdx = idx + dir;
      if (idx === -1 || newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }
  function deleteTopic(id) {
    setTopics((prev) => prev.filter((t) => t.id !== id));
    if (activeTopicId === id) {
      setActiveTopicId(null);
      setActiveTaskId(null);
    }
  }
  function resetAll() {
    // Remove the legacy key too, otherwise old data could be migrated back in on next load
    try {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(FOCUS_KEY);
    } catch (e) {
      console.error("reset failed", e);
    }
    focusRef.current = null;
    setFocus(null);
    setFocusOpen(false);
    setTopics([]);
    setActiveTopicId(null);
    setActiveTaskId(null);
    setWizard(null);
    setSettingsOpen(false);
    setNotice("כל הנתונים אופסו");
  }
  function saveGoal(goal) {
    if (activeTopic) updateTopic(activeTopic.id, (t) => ({ ...t, goal }));
  }

  // ----- master tasks -----
  function addMaster(title) {
    const n = newNode(title);
    updateActiveTasks((tasks) => [...tasks, n]);
    setActiveTaskId(n.id);
  }
  function deleteMaster(id) {
    updateActiveTasks((tasks) => tasks.filter((t) => t.id !== id));
    if (activeTaskId === id) setActiveTaskId(null);
  }
  function moveMaster(id, dir) {
    updateActiveTasks((tasks) => {
      const idx = tasks.findIndex((t) => t.id === id);
      const newIdx = idx + dir;
      if (idx === -1 || newIdx < 0 || newIdx >= tasks.length) return tasks;
      const copy = [...tasks];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }
  function moveMasterToTopic(taskId, toTopicId) {
    if (!activeTopic) return;
    const task = activeTopic.tasks.find((t) => t.id === taskId);
    if (!task) return;
    setTopics((prev) =>
      prev.map((t) => {
        if (t.id === activeTopic.id) return { ...t, tasks: t.tasks.filter((x) => x.id !== taskId) };
        if (t.id === toTopicId) return { ...t, tasks: [...t.tasks, task] };
        return t;
      })
    );
    if (activeTaskId === taskId) setActiveTaskId(null);
    // keep an open work session pointing at the task's new topic
    const f = focusRef.current;
    if (f && f.taskId === taskId) {
      const next = { ...f, topicId: toTopicId };
      focusRef.current = next;
      setFocus(next);
    }
  }

  // ----- tree inside a master task -----
  function addChildTop() {
    const title = newChildTitle.trim();
    if (!title || !activeTask) return;
    updateActiveTasks((tasks) => addChildNode(tasks, activeTask.id, newNode(title)));
    setNewChildTitle("");
  }
  const toggleDone = (id) => updateActiveTasks((tasks) => updateNode(tasks, id, (n) => ({ ...n, done: !n.done })));
  const updateSmart = (id, smart) => updateActiveTasks((tasks) => updateNode(tasks, id, (n) => ({ ...n, smart })));
  const addChild = (parentId, child) => updateActiveTasks((tasks) => addChildNode(tasks, parentId, child));
  const deleteNode = (id) => updateActiveTasks((tasks) => removeNode(tasks, id));
  const toggleCollapse = (id) => updateActiveTasks((tasks) => updateNode(tasks, id, (n) => ({ ...n, collapsed: !n.collapsed })));

  function scrollByCard(dir) {
    scrollerRef.current?.scrollBy({ left: dir * 176, behavior: "smooth" });
  }

  // ----- backup -----
  function exportBackup() {
    const data = JSON.stringify({ version: 5, topics, activeTopicId }, null, 2);
    const fname = `גיבוי-מטרות-${new Date().toISOString().slice(0, 10)}.json`;
    if (isNative()) {
      shareBackup(fname, data).catch(() => setNotice("לא הצלחתי לשמור את הגיבוי"));
      return;
    }
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `גיבוי-מטרות-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!looksLikeBackup(parsed)) throw new Error("not a backup");
        const restored = migrate(parsed);
        setTopics(restored.topics);
        setActiveTopicId(restored.activeTopicId);
        setActiveTaskId(null);
        setNotice(`הגיבוי נטען: ${restored.topics.length} נושאים`);
      } catch (err) {
        console.error("restore failed", err);
        setNotice("הקובץ לא נראה כמו קובץ גיבוי. לא שונה כלום.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const nextLeafId = activeTask ? findFirstUndoneLeafId(activeTask.children) : null;
  const overall = activeTask ? nodeProgress(activeTask) : null;
  const wizardTopic = wizard?.mode === "goal" ? topics.find((t) => t.id === wizard.topicId) : null;

  return (
    <div dir="rtl" className="w-full min-h-screen flex flex-col gap-4 p-4" style={{ background: COLORS.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" width={34} height={34} className="rounded-lg shrink-0" />
          <div className="leading-tight">
            <h1 className="text-lg font-bold" style={{ color: COLORS.text }}>{APP_NAME}</h1>
            <p className="text-[11px]" style={{ color: COLORS.textSoft }}>{APP_TAGLINE}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportBackup} className="text-xs flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
            <Download size={13} /> גיבוי
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="text-xs flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
            <Upload size={13} /> שחזור
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={importBackup} className="hidden" />
          <button onClick={() => setSettingsOpen(true)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} aria-label="הגדרות">
            <Settings size={15} style={{ color: COLORS.text }} />
          </button>
        </div>
      </div>

      {focus && focusTask && !focusOpen && focus.timer.running && (
        <FocusBanner focus={focus} taskTitle={focusTask.title} onOpen={() => setFocusOpen(true)} />
      )}

      {visibleTopics.length === 0 ? (
        <div className="rounded-xl p-8 flex flex-col items-center text-center gap-3" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <p className="text-base font-bold" style={{ color: COLORS.text }}>אין עדיין נושאים</p>
          <p className="text-sm max-w-sm" style={{ color: COLORS.textSoft }}>כל נושא הוא טאב עם מטרה אחת ברורה. נתחיל בשאלון קצר שמגדיר אותה.</p>
          <button onClick={() => setWizard({ mode: "new" })} className="rounded-md px-4 py-2 text-sm font-medium" style={{ background: COLORS.accent, color: "#fff" }}>
            צור נושא ראשון
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {visibleTopics.map((t) => (
              <TopicTab key={t.id} topic={t} isActive={activeTopic?.id === t.id} onClick={() => selectTopic(t.id)} />
            ))}
          </div>

          {activeTopic && (
            <>
              <GoalCard topic={activeTopic} onSave={saveGoal} onDefine={() => setWizard({ mode: "goal", topicId: activeTopic.id })} />

              <MasterTaskStrip
                scrollerRef={scrollerRef}
                tasks={activeTopic.tasks}
                color={activeTopic.color}
                activeId={activeTask?.id ?? null}
                onSelect={setActiveTaskId}
                onAdd={addMaster}
                onMove={moveMaster}
                onScrollBy={scrollByCard}
                showMove={activeTopic.inbox}
                moveTargets={topics.filter((t) => t.id !== activeTopic.id && !t.inbox)}
                onRecategorize={moveMasterToTopic}
              />

              <div className="flex-1 rounded-xl p-5" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                {!activeTask ? (
                  <div className="h-full flex items-center justify-center text-center py-12">
                    <p style={{ color: COLORS.textSoft }}>בחר משימה, או הוסף חדשה בנושא הזה, כדי לפרק אותה לצעדים.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: activeTopic.color }} />
                        <div>
                          <h2 className="text-xl font-bold" style={{ color: COLORS.text }}>{activeTask.title}</h2>
                          {overall.total > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: COLORS.textSoft }}>
                              {overall.done}/{overall.total} צעדים סופיים הושלמו בכל העץ
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => openFocus(activeTopic.id, activeTask.id)}
                          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
                          style={{ background: COLORS.accent, color: "#fff" }}
                        >
                          <Play size={14} /> עבוד על המשימה
                        </button>
                        <button onClick={() => setConfirmMasterId((c) => (c === activeTask.id ? null : activeTask.id))} className="opacity-50 hover:opacity-100" style={{ color: COLORS.danger }} aria-label="מחק משימה">
                          <X size={18} />
                        </button>
                      </div>
                    </div>

                    {confirmMasterId === activeTask.id && (
                      <DeleteConfirm
                        message={deleteMessage("משימה", activeTask)}
                        onConfirm={() => { setConfirmMasterId(null); deleteMaster(activeTask.id); }}
                        onCancel={() => setConfirmMasterId(null)}
                      />
                    )}

                    <div className="flex flex-col">
                      {activeTask.children.map((child) => (
                        <TreeNode
                          key={child.id}
                          node={child}
                          depth={0}
                          nextLeafId={nextLeafId}
                          onToggleDone={toggleDone}
                          onUpdateSmart={updateSmart}
                          onAddChild={addChild}
                          onDelete={deleteNode}
                          onToggleCollapse={toggleCollapse}
                        />
                      ))}
                      {activeTask.children.length === 0 && (
                        <p className="text-sm py-4 text-center" style={{ color: COLORS.textSoft }}>
                          אין עדיין צעדים. תתחיל בפירוק ראשון — כל צעד אפשר לפרק שוב, כמה שרוצים.
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1 border-t" style={{ borderColor: COLORS.border }}>
                      <input
                        value={newChildTitle}
                        onChange={(e) => setNewChildTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addChildTop()}
                        placeholder="צעד חדש ברמה הראשונה..."
                        className="flex-1 text-sm rounded-md px-3 py-2 outline-none mt-3"
                        style={{ border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text }}
                      />
                      <button onClick={addChildTop} className="rounded-md px-3 mt-3 flex items-center gap-1 text-sm font-medium" style={{ background: COLORS.warm, color: "#fff" }}>
                        <Plus size={15} /> הוסף
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {focusOpen && focus && focusTopic && focusTask && (
        <FocusPage
          topic={focusTopic}
          task={focusTask}
          timer={focus.timer}
          settings={pSettings}
          onAction={focusAction}
          onSettings={changeTimerSettings}
          onToggleStep={focusToggleStep}
          onAddStep={focusAddStep}
          onExit={closeFocus}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          topics={topics}
          timerSettings={pSettings}
          onTimerSettings={changeTimerSettings}
          onNewTopic={() => { setSettingsOpen(false); setWizard({ mode: "new" }); }}
          onDelete={deleteTopic}
          onMove={moveTopic}
          onExport={exportBackup}
          onReset={resetAll}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {wizard && (
        <Wizard
          key={wizard.mode + (wizard.topicId || "")}
          askName={wizard.mode === "new"}
          initial={wizardTopic ? { name: wizardTopic.name, color: wizardTopic.color, goal: wizardTopic.goal } : {}}
          onCancel={() => setWizard(null)}
          onFinish={finishWizard}
        />
      )}

      {notice && (
        <div className="fixed bottom-4 inset-x-4 z-50 flex justify-center pointer-events-none">
          <div className="rounded-full px-4 py-2 text-sm shadow-md" style={{ background: COLORS.text, color: "#fff" }}>{notice}</div>
        </div>
      )}
    </div>
  );
}

// Shown on the main screen while a timer is running but the work page is closed
function FocusBanner({ focus, taskTitle, onOpen }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <button
      onClick={onOpen}
      className="rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-right"
      style={{ background: COLORS.accent, color: "#fff" }}
      aria-label="חזרה למשימה שבעבודה"
    >
      <span className="flex items-center gap-2 min-w-0">
        <Timer size={16} className="shrink-0" />
        <span className="text-sm truncate">{MODE_LABEL[focus.timer.mode]} · {taskTitle}</span>
      </span>
      <span dir="ltr" className="text-base font-bold tabular-nums shrink-0">{formatClock(timerRemaining(focus.timer, now))}</span>
    </button>
  );
}
