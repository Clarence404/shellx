import { create } from "zustand";
import type { PassphraseReq } from "../types/connect-error";

interface PassphraseState {
  req: PassphraseReq | null;
  push: (host: PassphraseReq["host"]) => void;
  clear: () => void;
}

export const usePassphrase = create<PassphraseState>((set, get) => ({
  req: null,

  push(host) {
    const prev = get().req;
    set({
      req: {
        host,
        attempt: (prev?.attempt ?? 0) + 1,
        error: prev ? "passphrase 不正确，请重新输入" : null,
      },
    });
  },

  clear() {
    set({ req: null });
  },
}));
