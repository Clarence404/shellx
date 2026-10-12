import { openUrl } from "@tauri-apps/plugin-opener";

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
    // Nothing useful to say to the user: the link is visible, and they
    // can copy it. Leave a trace for the log stream instead.
    console.warn("shellx: could not open", url, e);
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
