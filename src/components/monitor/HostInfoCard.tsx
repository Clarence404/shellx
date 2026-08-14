import { Monitor } from "lucide-react";
import type { SystemInfo, MemInfo } from "../../types/monitor";
import { useSessions } from "../../state/sessions";
import { useHostsStore } from "../../state/hosts";
import { useT } from "../../i18n";

function formatUptime(secs: number, t: (k: string) => string): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}${t("d")} ${hours}${t("h")}`;
  if (hours > 0) return `${hours}${t("h")} ${mins}${t("m")}`;
  return `${mins}${t("m")}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatBootTime(uptimeSecs: number): string {
  const boot = new Date(Date.now() - uptimeSecs * 1000);
  return (
    `${boot.getFullYear()}-${pad2(boot.getMonth() + 1)}-${pad2(boot.getDate())} ` +
    `${pad2(boot.getHours())}:${pad2(boot.getMinutes())}`
  );
}

function detectDistro(os: string): { name: string; color: string } {
  const s = (os || "").toLowerCase();
  if (s.includes("ubuntu")) return { name: "Ubuntu", color: "#E95420" };
  if (s.includes("debian")) return { name: "Debian", color: "#A81D33" };
  if (s.includes("centos")) return { name: "CentOS", color: "#932279" };
  if (s.includes("red hat") || s.includes("rhel")) return { name: "RHEL", color: "#EE0000" };
  if (s.includes("fedora")) return { name: "Fedora", color: "#294172" };
  if (s.includes("rocky")) return { name: "Rocky Linux", color: "#10B981" };
  if (s.includes("alma")) return { name: "AlmaLinux", color: "#0E7C4A" };
  if (s.includes("opensuse") || s.includes("suse")) return { name: "SUSE", color: "#73BA25" };
  if (s.includes("arch")) return { name: "Arch", color: "#1793D1" };
  if (s.includes("alpine")) return { name: "Alpine", color: "#0D597F" };
  if (s.includes("kali")) return { name: "Kali", color: "#367BF0" };
  if (s.includes("manjaro")) return { name: "Manjaro", color: "#35BF5C" };
  if (s.includes("mint")) return { name: "Linux Mint", color: "#87CF3E" };
  if (s.includes("oracle")) return { name: "Oracle Linux", color: "#F80000" };
  return { name: "Linux", color: "var(--text-3)" };
}

function fmtKb(kb: number): string {
  if (kb >= 1_073_741_824) return `${(kb / 1_073_741_824).toFixed(1)} TB`;
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

function formatVirt(v: string, t: (k: string) => string): string {
  const s = (v || "").toLowerCase();
  if (!s || s === "none") return t("Bare metal");
  const map: Record<string, string> = {
    kvm: "KVM",
    vmware: "VMware",
    microsoft: "Hyper-V",
    oracle: "VirtualBox",
    xen: "Xen",
    qemu: "QEMU",
    bochs: "Bochs",
    parallels: "Parallels",
    docker: "Docker",
    lxc: "LXC",
    "lxc-libvirt": "LXC",
    podman: "Podman",
    rkt: "rkt",
    systemd: "systemd-nspawn",
    wsl: "WSL",
    proot: "PRoot",
  };
  return map[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

function shortenCpuModel(model: string): string {
  return (model || "")
    .replace(/\(R\)|\(TM\)|\(r\)|\(tm\)/g, "")
    .replace(/\s+CPU\s+/i, " ")
    .replace(/\s+@\s+.+$/, "")
    .replace(/\s+Processor\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Props {
  system: SystemInfo;
  memory: MemInfo;
  connectionId: string;
}

export function HostInfoCard({ system, memory, connectionId }: Props) {
  const t = useT();
  const session = useSessions((s) => s.sessions.find((x) => x.id === connectionId));
  const host = useHostsStore((s) =>
    session?.host_id ? s.hosts.find((h) => h.id === session.host_id) : undefined
  );

  const user = host?.username ?? "";
  const addr = host?.host ?? "";
  const userAtHost = user && addr ? `${user}@${addr}` : session?.label ?? "—";

  const distro = detectDistro(system.os);
  const osValue: React.ReactNode = system.os ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span
        title={distro.name}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: distro.color,
          flexShrink: 0,
          boxShadow: `0 0 0 2px color-mix(in srgb, ${distro.color} 20%, transparent)`,
        }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {system.os}
      </span>
    </span>
  ) : (
    "—"
  );

  const cpuShort = shortenCpuModel(system.cpuModel);

  const leftRows: Array<[string, React.ReactNode]> = [
    [t("System"), osValue],
    [t("Kernel"), system.kernel || "—"],
    ["CPU", cpuShort || "—"],
    [t("Hostname"), system.hostname || "—"],
    [t("Boot"), system.uptimeSecs > 0 ? formatBootTime(system.uptimeSecs) : "—"],
  ];

  const rightRows: Array<[string, React.ReactNode]> = [
    [t("Virtualization"), formatVirt(system.virt, t)],
    [t("Architecture"), system.arch || "—"],
    [t("Memory"), memory.totalKb > 0 ? fmtKb(memory.totalKb) : "—"],
    ["IP", addr || "—"],
    [t("Uptime"), system.uptimeSecs > 0 ? formatUptime(system.uptimeSecs, t) : "—"],
  ];

  return (
    <div
      style={{
        margin: 12,
        padding: "14px 16px",
        background: "var(--panel-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flexShrink: 0,
      }}
    >
      {/* Header — icon badge + title/subtitle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--accent-fade)",
            color: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Monitor size={18} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {userAtHost}
          </span>
          {session?.label && session.label !== userAtHost && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {session.label}
            </span>
          )}
        </div>
      </div>

      {/* Two-column table */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 28,
          rowGap: 6,
        }}
      >
        <InfoColumn rows={leftRows} labelWidth={64} />
        <InfoColumn rows={rightRows} labelWidth={96} />
      </div>
    </div>
  );
}

function InfoColumn({ rows, labelWidth }: { rows: Array<[string, React.ReactNode]>; labelWidth: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              width: labelWidth,
              flexShrink: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-1)",
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
