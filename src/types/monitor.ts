export interface CpuInfo {
  totalPct: number;
  corePct: number[];
}

export interface MemInfo {
  totalKb: number;
  usedKb: number;
  cachedKb: number;
  freeKb: number;
  swapTotalKb: number;
  swapUsedKb: number;
}

export interface NetworkInfo {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface ProcessRow {
  pid: number;
  cpuPct: number;
  memPct: number;
  name: string;
}

export interface DiskMount {
  target: string;
  sizeMb: number;
  usedMb: number;
  availMb: number;
  usePct: number;
}

export interface DiskIo {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  uptimeSecs: number;
}

export interface MonitorSnapshot {
  connectionId: string;
  ts: number;
  cpu: CpuInfo | null;
  memory: MemInfo;
  network: NetworkInfo[];
  processes: ProcessRow[];
  disks: DiskMount[];
  diskIo: DiskIo;
  system: SystemInfo;
}
