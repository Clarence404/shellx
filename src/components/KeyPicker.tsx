import { useEffect, useMemo, useRef, useState } from "react";
import { keysDiscover } from "../ipc/keys";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useT } from "../i18n";
import type { DiscoveredKey } from "../ipc/keys";

// Windows paths can arrive with either \ or / depending on whether they came
// from keysDiscover() (forward slashes) or from a stored DB value (whatever
// the file picker produced). Normalise before comparing.
function normPath(p: string) { return p.replace(/\\/g, "/"); }

/**
 * The SSH key picker, shared by the host form and the FTP-view form so
 * the two never drift: keys found under ~/.ssh render as one-click
 * chips (a dropdown once there are five or more), PuTTY/SSH2 keys show
 * disabled with a conversion hint, and Browse… covers a key living
 * anywhere else.
 */
export function KeyPicker({ value, onChange, autoPreselect }: {
  value: string | null;
  onChange: (path: string | null) => void;
  /** Pre-select the best discovered key when nothing is chosen yet —
   *  the create-mode nicety; edit mode leaves the stored choice alone. */
  autoPreselect?: boolean;
}) {
  const t = useT();
  const [discoveredKeys, setDiscoveredKeys] = useState<DiscoveredKey[]>([]);
  const [keyDropdownOpen, setKeyDropdownOpen] = useState(false);
  const [keyFilter, setKeyFilter] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const supportedKeys = useMemo(
    () => discoveredKeys.filter((k) => k.kind === "supported"),
    [discoveredKeys],
  );
  const filteredKeys = useMemo(
    () => supportedKeys.filter((k) =>
      k.fileName.toLowerCase().includes(keyFilter.toLowerCase())
    ),
    [supportedKeys, keyFilter],
  );

  useEffect(() => {
    keysDiscover().then((keys) => {
      setDiscoveredKeys(keys);
      if (autoPreselect && !value) {
        const firstSupported = keys.find((k) => k.kind === "supported");
        if (firstSupported) onChange(firstSupported.path);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!keyDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setKeyDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [keyDropdownOpen]);

  async function handleBrowse() {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "SSH Keys", extensions: [] }],
    });
    if (typeof p === "string") onChange(p);
  }

  const unsupportedKeys = discoveredKeys.filter((k) => k.kind !== "supported");
  // If the currently selected path isn't in the discovered list (e.g. was
  // manually browsed or came from a stored value), surface it as a
  // standalone chip so the user can see something is selected.
  const selectedInList = value
    ? supportedKeys.some((k) => normPath(k.path) === normPath(value))
    : true;
  const externalChip = value && !selectedInList ? (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "3px 8px", fontSize: 11, borderRadius: 4,
      border: "1px solid var(--accent)",
      background: "var(--accent)", color: "var(--text-on-accent)",
    }}>
      <span>{value.split(/[/\\]/).pop()}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
          color: "inherit", fontSize: 13, lineHeight: 1 }}
        title={t("Deselect")}
      >×</button>
    </div>
  ) : null;

  const unsupportedChips = unsupportedKeys.map((k) => (
    <div
      key={k.path}
      role="button"
      aria-disabled="true"
      title={
        k.kind === "ppk"
          ? "PuTTY 格式 — 需转换：puttygen key.ppk -O private-openssh"
          : "SSH2 格式 — 需转换"
      }
      style={{
        opacity: 0.55, cursor: "not-allowed", padding: "3px 8px",
        fontSize: 11, borderRadius: 4, border: "1px solid var(--border)",
        background: "var(--panel-1)",
      }}
    >
      {k.fileName}
    </div>
  ));

  if (supportedKeys.length >= 5) {
    // Dropdown mode for 5+ supported keys
    const selectedKey = supportedKeys.find((k) => normPath(k.path) === normPath(value ?? ""));
    return (
      <div ref={dropdownRef} style={{ position: "relative" }}>
        {externalChip && <div style={{ marginBottom: 4 }}>{externalChip}</div>}
        <button
          type="button"
          onClick={() => setKeyDropdownOpen((v) => !v)}
          style={{
            width: "100%", textAlign: "left", padding: "5px 8px", fontSize: 12,
            background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4,
            color: "var(--text-1)", cursor: "pointer",
          }}
        >
          {selectedKey?.fileName ?? "— choose a key —"}
        </button>
        {keyDropdownOpen && (
          <div style={{
            position: "absolute", zIndex: 10, top: "100%", left: 0, right: 0,
            background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)", overflow: "hidden",
          }}>
            <input
              type="text"
              value={keyFilter}
              onChange={(e) => setKeyFilter(e.target.value)}
              placeholder={t("Filter…")}
              style={{
                width: "100%", padding: "6px 8px", fontSize: 12,
                background: "var(--panel-1)", border: "none",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-1)", boxSizing: "border-box",
              }}
            />
            <div style={{ maxHeight: 160, overflowY: "auto" }}>
              {filteredKeys.map((k) => (
                <button
                  key={k.path}
                  type="button"
                  onClick={() => {
                    onChange(k.path);
                    setKeyDropdownOpen(false);
                    setKeyFilter("");
                  }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "5px 8px", fontSize: 12, border: "none", cursor: "pointer",
                    background: normPath(k.path) === normPath(value ?? "") ? "var(--accent)" : "transparent",
                    color: normPath(k.path) === normPath(value ?? "") ? "var(--text-on-accent)" : "var(--text-1)",
                  }}
                >
                  {k.fileName}
                  {k.algo && (
                    <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 6 }}>{k.algo}</span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={async () => { await handleBrowse(); setKeyDropdownOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "5px 8px", fontSize: 12, border: "none",
                  borderTop: "1px solid var(--border)", cursor: "pointer",
                  background: "transparent", color: "var(--text-2)",
                }}
              >
                {t("Browse…")}
              </button>
            </div>
          </div>
        )}
        {unsupportedChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {unsupportedChips}
          </div>
        )}
      </div>
    );
  }

  // Chips row mode for 0–4 supported keys
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {externalChip}
      {supportedKeys.map((k) => (
        <button
          key={k.path}
          type="button"
          onClick={() => onChange(k.path)}
          style={{
            padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
            border: "1px solid var(--border)",
            background: normPath(k.path) === normPath(value ?? "") ? "var(--accent)" : "var(--panel-1)",
            color: normPath(k.path) === normPath(value ?? "") ? "var(--text-on-accent)" : "var(--text-1)",
          }}
        >
          {k.fileName}
        </button>
      ))}
      {unsupportedChips}
      <button
        type="button"
        onClick={() => void handleBrowse()}
        style={{
          padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
          border: "1px solid var(--border)", background: "var(--panel-1)",
          color: "var(--text-2)",
        }}
      >
        {t("Browse…")}
      </button>
    </div>
  );
}
