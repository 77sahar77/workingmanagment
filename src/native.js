// Native (Android APK) helpers. On the web every function is a safe no-op / fallback.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const NOTIF_ID = 4101;
const CHANNEL = "timer-v1";
let ready = false;

async function setup() {
  if (ready) return true;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== "granted") perm = await LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return false;
  try {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== "granted") await LocalNotifications.changeExactNotificationSetting();
  } catch { /* older Android: exact alarms need no permission */ }
  await LocalNotifications.createChannel({
    id: CHANNEL, name: "טיימר", description: "סיום סבב ריכוז או הפסקה",
    importance: 5, visibility: 1, vibration: true,
  });
  ready = true;
  return true;
}

// Schedule one notification for the moment the running timer ends (replaces any previous one).
export async function scheduleTimerEnd(endAt, finishedMode) {
  if (!isNative()) return;
  try {
    if (!(await setup())) return;
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] });
    if (endAt <= Date.now()) return;
    const focus = finishedMode === "focus";
    await LocalNotifications.schedule({
      notifications: [{
        id: NOTIF_ID,
        title: focus ? "סבב הריכוז הסתיים" : "ההפסקה נגמרה",
        body: focus ? "הגיע הזמן לנשום ולקחת הפסקה." : "חוזרים לעבודה?",
        channelId: CHANNEL,
        schedule: { at: new Date(endAt), allowWhileIdle: true },
      }],
    });
  } catch { /* notifications are best-effort */ }
}

export async function cancelTimerEnd() {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] }); } catch { /* ignore */ }
}

// Save a backup. In the app: write to cache and open the share sheet (Drive, WhatsApp, Files...).
export async function shareBackup(filename, json) {
  const { uri } = await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: filename, files: [uri], dialogTitle: "שמירת גיבוי" });
}
