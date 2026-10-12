import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** Asked for once per app run, not once per alert. */
let granted: boolean | null = null;

/**
 * Raise an OS notification, asking for permission the first time.
 *
 * Returns false when the user has refused, when the platform has no
 * notification service, or in a browser-only test run — an alert that
 * can't reach the OS still shows in-app, so a failure here is never
 * worth surfacing.
 */
export async function notifyOs(title: string, body: string): Promise<boolean> {
  try {
    if (granted === null) {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
    }
    if (!granted) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget the cached answer so the next call asks again. */
export function resetNotifyPermission(): void {
  granted = null;
}
