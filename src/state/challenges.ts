import { create } from "zustand";
import { hostkeyRespond, type HostkeyChallenge } from "../ipc/hostkeys";

interface ChallengesState {
  pending: HostkeyChallenge[];
  push(c: HostkeyChallenge): void;
  resolve(attemptId: string, accept: boolean): void;
}

export const useChallenges = create<ChallengesState>((set) => ({
  pending: [],
  push: (c) => set((s) => ({ pending: [...s.pending, c] })),
  resolve: (attemptId, accept) => {
    void hostkeyRespond(attemptId, accept);
    set((s) => ({ pending: s.pending.filter((c) => c.attemptId !== attemptId) }));
  },
}));
