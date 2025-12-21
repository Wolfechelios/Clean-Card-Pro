import { create } from 'zustand';

interface ProcessInfo {
  id: string;
  name: string;
  startedAt: Date;
}

interface GlobalProcessControlState {
  runningProcesses: ProcessInfo[];
  stopSignal: number;
  registerProcess: (id: string, name: string) => void;
  unregisterProcess: (id: string) => void;
  stopAllProcesses: () => void;
  isProcessRunning: (id: string) => boolean;
  shouldStop: (processStartTime: number) => boolean;
}

export const useGlobalProcessControl = create<GlobalProcessControlState>((set, get) => ({
  runningProcesses: [],
  stopSignal: 0,
  
  registerProcess: (id: string, name: string) => {
    set((state) => ({
      runningProcesses: [
        ...state.runningProcesses.filter(p => p.id !== id),
        { id, name, startedAt: new Date() }
      ]
    }));
  },
  
  unregisterProcess: (id: string) => {
    set((state) => ({
      runningProcesses: state.runningProcesses.filter(p => p.id !== id)
    }));
  },
  
  stopAllProcesses: () => {
    set((state) => ({
      stopSignal: Date.now(),
      runningProcesses: []
    }));
  },
  
  isProcessRunning: (id: string) => {
    return get().runningProcesses.some(p => p.id === id);
  },
  
  shouldStop: (processStartTime: number) => {
    const { stopSignal } = get();
    return stopSignal > processStartTime;
  }
}));
