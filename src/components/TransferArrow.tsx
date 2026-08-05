import { ArrowLeftRight } from "lucide-react";
import { useRailFiles } from "../state/railFiles";

export function TransferArrow() {
  const leftSel = useRailFiles((s) => s.leftSelected);
  const rightSel = useRailFiles((s) => s.rightSelected);
  const transfer = useRailFiles((s) => s.transfer);
  const rightHost = useRailFiles((s) => s.rightHost);

  const leftHas = leftSel.length > 0;
  const rightHas = rightSel.length > 0;
  const enabled = !!rightHost && (leftHas !== rightHas); // exactly one side selected

  const direction = leftHas ? "up" : rightHas ? "down" : null;
  const tooltip = !enabled
    ? "Select on exactly one side to transfer"
    : direction === "up"
      ? `Upload ${leftSel.length} item(s) →`
      : `← Download ${rightSel.length} item(s)`;

  return (
    <button
      onClick={() => { if (enabled && direction) transfer(direction); }}
      disabled={!enabled}
      title={tooltip}
      aria-label={tooltip}
      style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", zIndex: 5,
        width: 28, height: 28, borderRadius: "50%",
        background: enabled ? "var(--accent)" : "var(--border)",
        color: enabled ? "var(--text-on-accent)" : "var(--text-3)",
        border: "none", cursor: enabled ? "pointer" : "not-allowed",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <ArrowLeftRight size={14} />
    </button>
  );
}
