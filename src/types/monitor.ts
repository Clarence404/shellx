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
  cpuModel: string;
  virt: string;
  hasDocker: boolean;
}

export interface ContainerRow {
  name: string;
  image: string;
  state: string;
  healthy: boolean | null;
  cpuPct: number;
  memUsedBytes: number;
  memLimitBytes: number;
  netIo: string;
  blockIo: string;
}

export interface FailedUnit {
  unit: string;
  result: string;
  exitStatus: string;
  since: string;
  description: string;
}

export interface LoadAvg {
  one: number;
  five: number;
  fifteen: number;
}

export interface SinceBoot {
  netRxTotal: number;
  netTxTotal: number;
  diskReadTotal: number;
  diskWriteTotal: number;
  cpuAvgPct: number;
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
  containers: ContainerRow[];
  containersLoaded: boolean;
  failedUnits: FailedUnit[];
  load: LoadAvg | null;
  sinceBoot: SinceBoot;
}
