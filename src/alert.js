// End-of-session alert: a short triple beep + vibration. Browsers only allow audio after a
// user gesture, so unlockAudio() must be called from the Start button's click handler.

let ctx = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    /* audio is optional */
  }
}

export function playAlert() {
  try {
    if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  } catch {
    /* ignore */
  }
  try {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [0, 0.28, 0.56].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1046 : 784;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.25);
    });
  } catch {
    /* ignore */
  }
}
