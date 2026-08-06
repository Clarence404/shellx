import { ArrowLeftRight } from "lucide-react";
import { useRailFiles } from "../state/railFiles";

export function TransferArrow() {
  const leftSel = useRailFiles((s) => s.leftSelected);
  const rightSel = useRailFiles((s) => s.rightSelected);
  const rightHost = useRailFiles((s) => s.rightHost);
  const percent = useRailFiles((s) => s.splitterPercent);

  const leftHas = leftSel.length > 0;
  const rightHas = rightSel.length > 0;
  const enabled = !!rightHost && (leftHas !== rightHas); // exactly one side selected

  // v0.5.7: only render when there's an actual transfer to trigger.
  // Previously the button sat visible-but-disabled at 50 % height,
  // overlapping file rows underneath and offering no info. With
  // drag-drop + right-click menus available, the ⇄ button is a
  // secondary path — hiding it when idle stops it from obstructing
  // the file list.
  if (!enabled) return null;

  const direction = leftHas ? "up" : "down";
  const tooltip = direction === "up"
    ? `Upload ${leftSel.length} item(s) →`
    : `← Download ${rightSel.length} item(s)`;

  return (
    <button
      onClick={() => useRailFiles.getState().transfer(direction)}
      title={tooltip}
      aria-label={tooltip}
      style={{
        position: "absolute", top: "50%", left: `${percent}%`,
        transform: "translate(-50%, -50%)", zIndex: 5,
        width: 28, height: 28, borderRadius: "50%",
        background: "var(--accent)",
        color: "var(--text-on-accent)",
        border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      }}
    >
      <ArrowLeftRight size={14} />
    </button>
  );
}
