import { invoke } from "@tauri-apps/api/core";
import type { ConnectionInfo } from "../types/connection";
import type { SerialLineSettings, SerialPortInfo, SerialProfile } from "../types/serial";

export const serialListPorts = (): Promise<SerialPortInfo[]> =>
  invoke<SerialPortInfo[]>("serial_list_ports");

export interface OpenSerialArgs extends SerialLineSettings {
  label: string;
  port: string;
}

// SerialSpec on the Rust side is camelCase; profile rows are snake_case.
export const openSerialSession = (a: OpenSerialArgs): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("open_serial_session", {
    args: {
      label: a.label,
      port: a.port,
      baud: a.baud,
      dataBits: a.data_bits,
      stopBits: a.stop_bits,
      parity: a.parity,
      flow: a.flow,
    },
  });

export interface NewSerialProfile extends Partial<SerialLineSettings> {
  label: string;
  port: string;
}

export const serialProfileList = (): Promise<SerialProfile[]> =>
  invoke<SerialProfile[]>("serial_profile_list");

export const serialProfileSave = (p: NewSerialProfile): Promise<SerialProfile> =>
  invoke<SerialProfile>("serial_profile_save", { args: p });

export const serialProfileUpdate = (
  id: string,
  patch: Partial<NewSerialProfile>,
): Promise<SerialProfile> =>
  invoke<SerialProfile>("serial_profile_update", { args: { id, ...patch } });

export const serialProfileDelete = (id: string): Promise<void> =>
  invoke<void>("serial_profile_delete", { args: { id } });
