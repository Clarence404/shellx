export interface SerialPortInfo {
  /** OS port name: "COM3" on Windows, "/dev/ttyUSB0" on Linux. */
  name: string;
  /** "usb" | "bluetooth" | "pci" | "unknown" */
  kind: string;
  /** USB product string ("CH340", "FT232R USB UART"), empty otherwise. */
  product: string;
}

export interface SerialLineSettings {
  baud: number;
  /** 5..=8 */
  data_bits: number;
  /** 1 | 2 */
  stop_bits: number;
  /** "none" | "even" | "odd" */
  parity: string;
  /** "none" | "rtscts" | "xonxoff" */
  flow: string;
}

export interface SerialProfile extends SerialLineSettings {
  id: string;
  label: string;
  port: string;
  created_at: number;
  sort_order: number;
}

export const DEFAULT_LINE: SerialLineSettings = {
  baud: 115200,
  data_bits: 8,
  stop_bits: 1,
  parity: "none",
  flow: "none",
};

/** What the Enter key sends on the wire. */
export type LineEnding = "cr" | "lf" | "crlf" | "none";

export const LINE_ENDING_LABELS: Record<LineEnding, string> = {
  cr: "CR (\\r)",
  lf: "LF (\\n)",
  crlf: "CRLF (\\r\\n)",
  none: "None",
};

/** "115200 · 8N1" — the standard shorthand electricians read at a glance. */
export function lineSummary(s: SerialLineSettings): string {
  const parity = s.parity === "even" ? "E" : s.parity === "odd" ? "O" : "N";
  return `${s.baud} · ${s.data_bits}${parity}${s.stop_bits}`;
}
