import { openUrl } from "@tauri-apps/plugin-opener";
import { logPush } from "./logs";

/**
 * Open a link in the user's own browser.
 *
 * A plain `<a target="_blank">` does nothing inside the Tauri webview —
 * there is no browser chrome to open a tab in — so every external link
 * in the app goes through here instead.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    // Nothing useful to say to the user mid-click: the link is on screen
    // and can be copied. It does belong in the log stream, though — the
    // first version of this shipped with the opener permission granted but
    // unscoped, so every call was denied and the button looked simply dead
    // with nothing anywhere to say why.
    console.warn("shellx: could not open", url, e);
    void logPush({
      level: "error", category: "ui",
      message: "could not open an external link",
      fields: { url, error: String(e) },
    });
  }
}

/**
 * Props for an `<a>` that should open externally: keeps the href (so the
 * URL is visible on hover and can be copied) while handing the click to
 * the OS.
 */
export function externalLinkProps(url: string) {
  return {
    href: url,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      void openExternal(url);
    },
  };
}
