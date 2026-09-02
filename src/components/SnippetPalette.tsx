import { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Plus, Pencil, Trash2, CornerDownLeft, ArrowLeft } from "lucide-react";
import { useSnippetsStore, loadSnippetsOnce } from "../state/snippets";
import { useSessions } from "../state/sessions";
import { writeSessionInput } from "../ipc/commands";
import { extractPlaceholders, fillPlaceholders } from "../terminal/placeholders";
import { useT } from "../i18n";
import type { Snippet } from "../types/snippets";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode =
  | { kind: "pick" }
  | { kind: "fill"; snippet: Snippet; names: string[] }
  | { kind: "manage"; editing: Snippet | null };

/**
 * The snippet palette (Ctrl+Shift+K): the user's own command library.
 * Filter, Enter — the command lands on the active terminal's input
 * line, unexecuted unless the snippet says auto-enter. A snippet with
 * `${placeholder}` blanks asks for them first. The same dialog manages
 * the library, so there is one place snippets live.
 */
export function SnippetPalette({ open, onClose }: Props) {
  const t = useT();
  const list = useSnippetsStore((s) => s.list);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "pick" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeSession = useSessions((s) =>
    s.sessions.find((x) => x.id === s.activeId && x.state === "active") ?? null,
  );

  useEffect(() => {
    if (open) {
      loadSnippetsOnce();
      setQuery("");
      setSelectedIdx(0);
      setMode({ kind: "pick" });
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
    );
  }, [list, query]);

  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIdx]);

  if (!open) return null;

  function send(snippet: Snippet, values?: Record<string, string>) {
    if (!activeSession) return;
    const text = values ? fillPlaceholders(snippet.command, values) : snippet.command;
    const payload = snippet.autoEnter ? `${text}\r` : text;
    void writeSessionInput(activeSession.id, Array.from(new TextEncoder().encode(payload)));
    onClose();
  }

  function pick(snippet: Snippet) {
    const names = extractPlaceholders(snippet.command);
    if (names.length > 0) setMode({ kind: "fill", snippet, names });
    else send(snippet);
  }

  function handlePickKeys(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[selectedIdx];
      if (chosen) pick(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="snippet palette"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" && mode.kind !== "pick") {
          e.preventDefault();
          e.stopPropagation();
          setMode({ kind: "pick" });
        }
      }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", justifyContent: "center", paddingTop: "10vh",
        zIndex: 200,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, background: "var(--panel-2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: 10, height: "fit-content", maxHeight: "72vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0 2px 8px",
          fontSize: 12, fontWeight: 600, color: "var(--text-1)",
        }}>
          <Zap size={13} style={{ color: "var(--accent)" }} />
          {t("Snippets")}
          <span style={{ flex: 1 }} />
          {mode.kind === "pick" && (
            <button
              type="button"
              onClick={() => setMode({ kind: "manage", editing: null })}
              style={{
                fontSize: 11, color: "var(--text-2)", background: "transparent",
                border: "1px solid var(--border-hi)", borderRadius: 4,
                padding: "2px 8px", cursor: "pointer",
              }}>
              {t("Manage snippets")}
            </button>
          )}
          {mode.kind !== "pick" && (
            <button
              type="button"
              aria-label={t("Back")}
              onClick={() => setMode({ kind: "pick" })}
              style={{
                fontSize: 11, color: "var(--text-2)", background: "transparent",
                border: "1px solid var(--border-hi)", borderRadius: 4,
                padding: "2px 8px", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
              <ArrowLeft size={11} /> {t("Back")}
            </button>
          )}
        </div>

        {mode.kind === "pick" && (
          <>
            {!activeSession && (
              <div style={{
                fontSize: 11, color: "var(--warn)", padding: "0 2px 6px",
              }}>
                {t("No active terminal — connect first, then pick a snippet.")}
              </div>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
              onKeyDown={handlePickKeys}
              placeholder={t("Type to filter snippets…")}
              style={{
                width: "100%", background: "var(--panel-1)",
                border: "1px solid var(--border)", borderRadius: 4,
                padding: "6px 8px", fontSize: 12, color: "var(--text-1)",
              }} />
            <div style={{ marginTop: 6, overflowY: "auto", minHeight: 0 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "10px 6px", color: "var(--text-3)", fontSize: 11 }}>
                  {list.length === 0
                    ? t("No snippets yet — save your first with Manage snippets.")
                    : t("No matching snippets.")}
                </div>
              ) : filtered.map((s, i) => (
                <div
                  key={s.id}
                  role="option"
                  aria-selected={i === selectedIdx}
                  onClick={() => pick(s)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    padding: "6px 8px", borderRadius: 4, cursor: "pointer",
                    background: i === selectedIdx ? "var(--accent-fade)" : "transparent",
                  }}>
                  <div style={{
                    fontSize: 12, color: "var(--text-1)", fontWeight: 500,
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{
                      flex: 1, minWidth: 0, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{s.name}</span>
                    {s.autoEnter && (
                      <span title={t("Runs on pick")} style={{
                        display: "inline-flex", color: "var(--warn)", flexShrink: 0,
                      }}>
                        <CornerDownLeft size={10} />
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: "var(--text-3)",
                    fontFamily: '"JetBrains Mono", var(--font-mono)',
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{s.command}</div>
                </div>
              ))}
            </div>
            <div style={{
              paddingTop: 8, fontSize: 10, color: "var(--text-3)",
              display: "flex", gap: 10,
            }}>
              <span>↑↓ {t("choose")}</span>
              <span>Enter {t("insert")}</span>
              <span>Esc {t("close")}</span>
            </div>
          </>
        )}

        {mode.kind === "fill" && (
          <FillForm
            snippet={mode.snippet}
            names={mode.names}
            onCancel={() => setMode({ kind: "pick" })}
            onSubmit={(values) => send(mode.snippet, values)}
          />
        )}

        {mode.kind === "manage" && (
          <ManagePane
            editing={mode.editing}
            onEdit={(s) => setMode({ kind: "manage", editing: s })}
            onDone={() => setMode({ kind: "manage", editing: null })}
          />
        )}
      </div>
    </div>
  );
}

/** The blanks of one snippet, asked for in order of appearance. */
function FillForm({ snippet, names, onCancel, onSubmit }: {
  snippet: Snippet;
  names: string[];
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    queueMicrotask(() => firstRef.current?.focus());
  }, []);

  const preview = fillPlaceholders(snippet.command, values);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}>
      <div style={{
        fontSize: 11, color: "var(--text-2)", padding: "0 2px 8px",
      }}>{snippet.name}</div>
      {names.map((name, i) => (
        <div key={name} style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>
            {name}
          </label>
          <input
            ref={i === 0 ? firstRef : undefined}
            aria-label={name}
            value={values[name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
            style={{
              width: "100%", background: "var(--panel-1)",
              border: "1px solid var(--border)", borderRadius: 4,
              padding: "5px 8px", fontSize: 12, color: "var(--text-1)",
            }} />
        </div>
      ))}
      <div style={{
        fontSize: 10.5, color: "var(--text-3)", padding: "2px 2px 8px",
        fontFamily: '"JetBrains Mono", var(--font-mono)',
        wordBreak: "break-all",
      }}>{preview}</div>
      {/* House rule for dialogs: Cancel left, the primary action right. */}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} style={{
          flex: 1, height: 26, borderRadius: 4, fontSize: 12,
          border: "1px solid var(--border-hi)", background: "transparent",
          color: "var(--text-2)", cursor: "pointer",
        }}>{t("Cancel")}</button>
        <button type="submit" style={{
          flex: 1, height: 26, borderRadius: 4, border: "none", fontSize: 12,
          background: "var(--accent)", color: "var(--text-on-accent)", fontWeight: 600,
          cursor: "pointer",
        }}>{t("Insert")}</button>
      </div>
    </form>
  );
}

/** The library itself: list with edit / delete, and the add / edit form. */
function ManagePane({ editing, onEdit, onDone }: {
  editing: Snippet | null;
  onEdit: (s: Snippet | null) => void;
  onDone: () => void;
}) {
  const t = useT();
  const list = useSnippetsStore((s) => s.list);
  const [name, setName] = useState(editing?.name ?? "");
  const [command, setCommand] = useState(editing?.command ?? "");
  const [autoEnter, setAutoEnter] = useState(editing?.autoEnter ?? false);
  const [adding, setAdding] = useState(!!editing);

  useEffect(() => {
    setName(editing?.name ?? "");
    setCommand(editing?.command ?? "");
    setAutoEnter(editing?.autoEnter ?? false);
    if (editing) setAdding(true);
  }, [editing]);

  async function save() {
    if (!name.trim() || !command.trim()) return;
    const st = useSnippetsStore.getState();
    if (editing) {
      await st.update(editing.id, { name: name.trim(), command, autoEnter });
    } else {
      await st.add({ name: name.trim(), command, autoEnter });
    }
    setAdding(false);
    setName(""); setCommand(""); setAutoEnter(false);
    onDone();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            height: 28, borderRadius: 4, marginBottom: 8, fontSize: 12,
            border: "1px solid var(--accent)", background: "var(--accent-fade)",
            color: "var(--text-1)", cursor: "pointer",
          }}>
          <Plus size={12} /> {t("New snippet")}
        </button>
      )}

      {adding && (
        <div style={{
          border: "1px solid var(--border)", borderRadius: 6,
          padding: 8, marginBottom: 8,
        }}>
          <input
            aria-label={t("Snippet name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Name, e.g. tail nginx log")}
            style={{
              width: "100%", background: "var(--panel-1)",
              border: "1px solid var(--border)", borderRadius: 4,
              padding: "5px 8px", fontSize: 12, color: "var(--text-1)", marginBottom: 6,
            }} />
          <textarea
            aria-label={t("Snippet command")}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={"tail -f /var/log/nginx/${file}"}
            rows={3}
            style={{
              width: "100%", background: "var(--panel-1)", resize: "vertical",
              border: "1px solid var(--border)", borderRadius: 4,
              padding: "5px 8px", fontSize: 12, color: "var(--text-1)",
              fontFamily: '"JetBrains Mono", var(--font-mono)', marginBottom: 4,
            }} />
          <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 6 }}>
            {t("${name} becomes a blank to fill when the snippet is used.")}
          </div>
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11.5, color: "var(--text-2)", marginBottom: 8,
          }}>
            <input type="checkbox" checked={autoEnter} onChange={(e) => setAutoEnter(e.target.checked)} />
            {t("Press Enter automatically (runs on pick)")}
          </label>
          {/* House rule for dialogs: Cancel left, the primary action right. */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => { setAdding(false); setName(""); setCommand(""); setAutoEnter(false); onDone(); }}
              style={{
                flex: 1, height: 26, borderRadius: 4, fontSize: 12,
                border: "1px solid var(--border-hi)", background: "transparent",
                color: "var(--text-2)", cursor: "pointer",
              }}>{t("Cancel")}</button>
            <button
              type="button"
              disabled={!name.trim() || !command.trim()}
              onClick={() => void save()}
              style={{
                flex: 1, height: 26, borderRadius: 4, border: "none", fontSize: 12,
                background: name.trim() && command.trim() ? "var(--accent)" : "var(--panel-1)",
                color: name.trim() && command.trim() ? "var(--text-on-accent)" : "var(--text-3)",
                fontWeight: 600, cursor: "pointer",
              }}>{t("Save")}</button>
          </div>
        </div>
      )}

      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {list.length === 0 && !adding && (
          <div style={{ padding: "8px 4px", fontSize: 11, color: "var(--text-3)" }}>
            {t("No snippets yet — save your first with Manage snippets.")}
          </div>
        )}
        {list.map((s) => (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 6px", borderRadius: 4,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, color: "var(--text-1)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{s.name}</div>
              <div style={{
                fontSize: 10.5, color: "var(--text-3)",
                fontFamily: '"JetBrains Mono", var(--font-mono)',
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{s.command}</div>
            </div>
            {s.autoEnter && (
              <span title={t("Runs on pick")} style={{ color: "var(--warn)", display: "inline-flex", flexShrink: 0 }}>
                <CornerDownLeft size={10} />
              </span>
            )}
            <button
              type="button"
              aria-label={`${t("Edit")} ${s.name}`}
              onClick={() => onEdit(s)}
              style={{
                background: "transparent", border: "none", color: "var(--text-3)",
                cursor: "pointer", padding: 3, display: "inline-flex",
              }}>
              <Pencil size={12} />
            </button>
            <button
              type="button"
              aria-label={`${t("Delete")} ${s.name}`}
              onClick={() => void useSnippetsStore.getState().remove(s.id)}
              style={{
                background: "transparent", border: "none", color: "var(--text-3)",
                cursor: "pointer", padding: 3, display: "inline-flex",
              }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
