export type GpuOffloadStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "degraded"
  | "disconnected"
  | "error";

export type GpuServerCapabilities = {
  streaming: boolean;
  http: boolean;
  ocr: boolean;
  identify: boolean;
  pricing: boolean;
  platform?: string;
  version?: string;
};

export type GpuPerfSnapshot = {
  rttMs: number | null;
  serverMs: number | null;
  fpsOut: number;
  fpsIn: number;
  dropped: number;
  lastMessageAt: number | null;
};

export type GpuIdentifyResult = {
  success: boolean;
  source: "gpu";
  cardData: {
    card_name: string;
    card_set: string | null;
    card_number: string | null;
    rarity: string | null;
    edition: string | null;
    game_type: string | null;
    sport_type: string | null;
    year: string | null;
    manufacturer: string | null;
    confidence: number;
    description?: string;
  };
  pricing?: {
    currentPriceRaw?: number | null;
    currentPricePsa9?: number | null;
    currentPricePsa10?: number | null;
    suggestedPrice?: number | null;
    ebayListingUrl?: string | null;
  };
  ocrText?: string;
  metrics?: {
    server_ms?: number;
    stage_ms?: Record<string, number>;
  };
  error?: string;
};

export type GpuStreamClientHello = {
  type: "hello";
  sessionId: string;
  client: {
    platform: string;
    appVersion?: string;
    userAgent?: string;
  };
  prefs?: {
    maxFps?: number;
    jpegQuality?: number;
    targetWidth?: number;
  };
};

export type GpuStreamClientFrame = {
  type: "frame";
  sessionId: string;
  frameId: string;
  sentAt: number;
  imageJpegDataUrl: string; // data:image/jpeg;base64,...
  hint?: {
    // Optional: if you already know crop/region
    region?: { x: number; y: number; w: number; h: number };
  };
};

export type GpuStreamClientPing = {
  type: "ping";
  sessionId: string;
  sentAt: number;
};

export type GpuStreamServerHello = {
  type: "hello";
  sessionId: string;
  capabilities: GpuServerCapabilities;
};

export type GpuStreamServerPong = {
  type: "pong";
  sessionId: string;
  sentAt: number;
  receivedAt: number;
  serverMs?: number;
};

export type GpuStreamServerResult = {
  type: "result";
  sessionId: string;
  frameId: string;
  receivedAt: number;
  serverMs?: number;
  card?: {
    name: string;
    set?: string | null;
    number?: string | null;
    rarity?: string | null;
    confidence?: number;
    value?: number | null;
  };
  ocrText?: string;
  error?: string;
};

export type GpuStreamServerMessage =
  | GpuStreamServerHello
  | GpuStreamServerPong
  | GpuStreamServerResult;

export type GpuStreamClientMessage =
  | GpuStreamClientHello
  | GpuStreamClientFrame
  | GpuStreamClientPing;
