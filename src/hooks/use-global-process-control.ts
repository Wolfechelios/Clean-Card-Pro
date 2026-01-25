import { create } from "zustand";

interface ProcessControlState {
  scannerActive: boolean;
  runningProcesses: Set<string>;
  setScannerActive: (active: boolean) => void;
  registerProcess: (id: string) => void;
  unregisterProcess: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  getState: () => ProcessControlState;
}

export const useGlobalProcessControl = create<ProcessControlState>((set, get) => ({
  scannerActive: false,
  runningProcesses: new Set(),
  
  setScannerActive: (active: boolean) => set({ scannerActive: active }),
  
  registerProcess: (id: string) =>
    set((state) => ({
      runningProcesses: new Set([...state.runningProcesses, id]),
    })),
  
  unregisterProcess: (id: string) =>
    set((state) => {
      const next = new Set(state.runningProcesses);
      next.delete(id);
      return { runningProcesses: next };
    }),
  
  pauseAll: () => {
    // Broadcast pause signal to all running processes
    window.dispatchEvent(new CustomEvent("global-pause-processes"));
  },
  
  resumeAll: () => {
    // Broadcast resume signal to all running processes
    window.dispatchEvent(new CustomEvent("global-resume-processes"));
  },
  
  getState: () => get(),
}));
