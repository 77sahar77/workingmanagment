import { useState, useEffect } from "react";
import { Play, Pause, RotateCcw, SkipForward, ArrowRight, Check, Plus, ChevronDown, ChevronUp, Settings } from "lucide-react";
import { COLORS } from "./theme.js";
import { APP_NAME, APP_TAGLINE } from "./brand.js";
import { MODES, MODE_LABEL, remaining, durationMs, formatClock, clampMinutes } from "./pomodoro.js";
import { flattenLeaves } from "./model.js";

const DEFAULT_TITLE = `${APP_NAME} · ${APP_TAGLINE}`;
const SETTING_LABEL = { focus: "ריכוז", short: "הפסקה קצרה", long: "הפסקה ארוכה" };

// Number field that only commits valid values while typing, and snaps back on blur
export function MinutesField({ label, value, onCommit, min = 1, max = 180 }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: COLORS.textSoft }}>
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={() => setText(String(value))}
        className="text-sm rounded-md px-2 py-1.5 outline-none w-full"
        style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
      />
    </label>
  );
}

function DeadlineChip({ iso }) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const overdue = d < new Date();
  return (
    <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: overdue ? "#F6DCD5" : COLORS.warmSoft, color: overdue ? COLORS.danger : COLORS.warm }}>
      {d.toLocaleDateString("he-IL", { day: "numeric", month: "short" })} · {d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function StepRow({ step, isNext, onToggle }) {
  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3"
      style={{ background: isNext && !step.done ? COLORS.accentSoft : COLORS.surface, border: `1px solid ${isNext && !step.done ? COLORS.accent : COLORS.border}` }}
    >
      <button
        onClick={() => onToggle(step.id)}
        className="mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: step.done ? COLORS.accent : "transparent", border: `2px solid ${step.done ? COLORS.accent : COLORS.textSoft}` }}
        aria-label={step.done ? "בטל סימון" : "סמן כהושלם"}
      >
        {step.done && <Check size={15} color="#fff" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {step.path.length > 0 && (
          <p className="text-[11px] leading-tight" style={{ color: COLORS.textSoft }}>{step.path.join(" › ")}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {isNext && !step.done && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: COLORS.accent, color: "#fff" }}>הצעד הבא</span>
          )}
          <p className="text-[15px] leading-snug" style={{ color: step.done ? COLORS.textSoft : COLORS.text, textDecoration: step.done ? "line-through" : "none" }}>{step.title}</p>
        </div>
        {step.smart?.measurable && !step.done && (
          <p className="text-xs" style={{ color: COLORS.textSoft }}>איך אדע: {step.smart.measurable}</p>
        )}
        <div><DeadlineChip iso={step.smart?.timebound} /></div>
      </div>
    </div>
  );
}

export default function FocusPage({ topic, task, timer, settings, onAction, onSettings, onToggleStep, onAddStep, onExit }) {
  const [now, setNow] = useState(() => Date.now());
  const [showDone, setShowDone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newStep, setNewStep] = useState("");

  // redraw the clock while running; the true end time lives in `timer.endAt`
  useEffect(() => {
    if (!timer.running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer.running]);

  const rem = remaining(timer, now);
  const total = durationMs(timer.mode, settings);
  const frac = total > 0 ? Math.min(1, Math.max(0, 1 - rem / total)) : 0;
  const clock = formatClock(rem);
  const started = !timer.running && timer.remainingMs < total;

  useEffect(() => {
    document.title = timer.running ? `${clock} · ${MODE_LABEL[timer.mode]}` : DEFAULT_TITLE;
  }, [timer.running, clock, timer.mode]);
  useEffect(() => () => { document.title = DEFAULT_TITLE; }, []);

  // keep the screen awake while a session runs (where supported)
  useEffect(() => {
    if (!timer.running || !navigator.wakeLock) return;
    let sentinel = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) s.release?.().catch?.(() => {});
        else sentinel = s;
      } catch {
        /* not allowed right now: fine */
      }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { sentinel?.release?.().catch?.(() => {}); } catch { /* ignore */ }
    };
  }, [timer.running]);

  const steps = flattenLeaves(task);
  const open = steps.filter((s) => !s.done);
  const done = steps.filter((s) => s.done);
  const nextId = open[0]?.id;
  const pct = steps.length ? Math.round((done.length / steps.length) * 100) : 0;
  const allDone = steps.length > 0 && open.length === 0;

  function submitStep() {
    const t = newStep.trim();
    if (!t) return;
    onAddStep(t);
    setNewStep("");
  }

  return (
    <div dir="rtl" className="fixed inset-0 z-30 overflow-y-auto" style={{ background: COLORS.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <div className="max-w-xl mx-auto p-4 flex flex-col gap-4" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between gap-3">
          <button onClick={onExit} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
            <ArrowRight size={15} /> חזרה
          </button>
          <span className="flex items-center gap-2 text-sm min-w-0" style={{ color: COLORS.textSoft }}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: topic.color }} />
            <span className="truncate">{topic.name}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold leading-snug" style={{ color: COLORS.text }}>{task.title}</h1>
          {steps.length > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1" style={{ color: COLORS.textSoft }}>
                <span>{done.length} מתוך {steps.length} צעדים</span>
                <span style={{ color: COLORS.accent, fontWeight: 600 }}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full w-full" style={{ background: COLORS.border }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS.accent }} />
              </div>
            </div>
          )}
          {task.pomodoros > 0 && (
            <p className="text-xs" style={{ color: COLORS.textSoft }}>{task.pomodoros} סבבי ריכוז הושלמו במשימה הזו</p>
          )}
        </div>

        {/* pomodoro */}
        <section className="rounded-2xl p-4 flex flex-col items-center gap-3" style={{ background: `${topic.color}1F`, border: `1px solid ${topic.color}55` }} aria-label="טיימר פומודורו">
          <div className="flex rounded-full p-1 gap-1 w-full max-w-xs" style={{ background: "rgba(255,255,255,0.7)" }} role="tablist">
            {MODES.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={timer.mode === m}
                onClick={() => onAction({ type: "mode", mode: m })}
                className="flex-1 rounded-full py-1.5 text-xs font-medium transition-colors"
                style={{ background: timer.mode === m ? COLORS.accent : "transparent", color: timer.mode === m ? "#fff" : COLORS.text }}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <div dir="ltr" className="font-bold leading-none tabular-nums select-none" style={{ fontSize: 76, color: COLORS.text }} aria-live="off" data-testid="clock">
            {clock}
          </div>

          <div className="h-1.5 rounded-full w-full max-w-xs" style={{ background: "rgba(255,255,255,0.8)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${frac * 100}%`, background: COLORS.accent }} />
          </div>

          <div className="flex items-center gap-1.5" aria-label={`${timer.cycleCount} מתוך ${settings.cycle} סבבים`}>
            {Array.from({ length: settings.cycle }).map((_, i) => (
              <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: i < timer.cycleCount ? COLORS.accent : "rgba(255,255,255,0.9)", border: `1px solid ${i < timer.cycleCount ? COLORS.accent : COLORS.border}` }} />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => onAction({ type: "reset" })} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.85)", color: COLORS.text }} aria-label="אפס טיימר">
              <RotateCcw size={18} />
            </button>
            {timer.running ? (
              <button onClick={() => onAction({ type: "pause" })} className="h-14 px-7 rounded-full flex items-center gap-2 text-base font-semibold" style={{ background: COLORS.accent, color: "#fff" }}>
                <Pause size={20} /> השהה
              </button>
            ) : (
              <button onClick={() => onAction({ type: "start" })} className="h-14 px-7 rounded-full flex items-center gap-2 text-base font-semibold" style={{ background: COLORS.accent, color: "#fff" }}>
                <Play size={20} /> {started ? "המשך" : "התחל"}
              </button>
            )}
            <button onClick={() => onAction({ type: "skip" })} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.85)", color: COLORS.text }} aria-label="דלג לשלב הבא">
              <SkipForward size={18} />
            </button>
          </div>

          <button onClick={() => setShowSettings((s) => !s)} className="text-xs flex items-center gap-1" style={{ color: COLORS.textSoft }}>
            <Settings size={12} /> משכי זמן
          </button>
          {showSettings && (
            <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
              {["focus", "short", "long"].map((k) => (
                <MinutesField key={k} label={`${SETTING_LABEL[k]} (דק׳)`} value={settings[k]} onCommit={(n) => onSettings({ ...settings, [k]: clampMinutes(n, settings[k]) })} />
              ))}
            </div>
          )}
        </section>

        {/* steps */}
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold" style={{ color: COLORS.text }}>הצעדים</h2>

          {allDone && (
            <div className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}` }}>
              <p className="text-sm font-semibold" style={{ color: COLORS.text }}>כל הצעדים הושלמו.</p>
              <button onClick={onExit} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: COLORS.accent, color: "#fff" }}>סיימתי, חזרה</button>
            </div>
          )}

          {open.map((s) => (
            <StepRow key={s.id} step={s} isNext={s.id === nextId} onToggle={onToggleStep} />
          ))}

          {steps.length === 0 && (
            <p className="text-sm py-2" style={{ color: COLORS.textSoft }}>עוד אין צעדים במשימה הזו. הוסף את הצעד הראשון למטה.</p>
          )}

          <div className="flex gap-2 pt-1">
            <input
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitStep()}
              placeholder="הוסף צעד..."
              className="flex-1 text-sm rounded-md px-3 py-2 outline-none"
              style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}
            />
            <button onClick={submitStep} className="rounded-md px-3 flex items-center gap-1 text-sm font-medium" style={{ background: COLORS.warm, color: "#fff" }}>
              <Plus size={15} /> הוסף
            </button>
          </div>

          {done.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={() => setShowDone((s) => !s)} className="flex items-center gap-1 text-sm self-start" style={{ color: COLORS.textSoft }}>
                {showDone ? <ChevronUp size={15} /> : <ChevronDown size={15} />} הושלמו ({done.length})
              </button>
              {showDone && done.map((s) => <StepRow key={s.id} step={s} isNext={false} onToggle={onToggleStep} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
