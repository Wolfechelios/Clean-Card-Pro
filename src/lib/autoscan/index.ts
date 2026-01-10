// src/lib/autoscan/index.ts
// Barrel export for autoscan modules

export { AutoScanController, DEFAULT_AUTOSCAN_TUNING } from "./AutoScanController";
export type { 
  AutoScanState, 
  FrameInput, 
  CaptureDecision, 
  AutoScanTuning 
} from "./AutoScanController";

export { FrameAnalyzer, DEFAULT_ANALYZER_CONFIG } from "./FrameAnalyzer";
export type { 
  BBox, 
  FrameAnalysis, 
  FrameAnalyzerConfig 
} from "./FrameAnalyzer";

export { ScanJobQueue, DEFAULT_QUEUE_CONFIG } from "./ScanJobQueue";
export type { 
  ScanJob, 
  JobResult, 
  JobProcessor, 
  QueueConfig, 
  QueueStatus, 
  JobStatusCallback 
} from "./ScanJobQueue";
