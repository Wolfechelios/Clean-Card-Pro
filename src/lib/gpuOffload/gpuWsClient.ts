import type {
  GpuOffloadStatus,
  GpuPerfSnapshot,
  GpuStreamClientHello,
  GpuStreamClientFrame,
  GpuStreamClientPing,
  GpuStreamServerMessage,
  GpuStreamServerResult,
} from "./types";
import { getGpuServerWsUrl, getGpuStreamPrefs } from "./gpuSettings";

type Handlers = {
  onStatus?: (s: GpuOffloadStatus, err?: string) => void;
  onResult?: (msg: GpuStreamServerResult) => void;
  onPerf?: (p: GpuPerfSnapshot) => void;
};

function safeUUID(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  return `sess-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

export class GpuWsClient {
  private ws: WebSocket | null = null;
  private status: GpuOffloadStatus = "disconnected";
  private sessionId = safeUUID();
  private handlers: Handlers;

  private lastSendAt = 0;
  private fpsOut = 0;
  private fpsIn = 0;
  private dropped = 0;
  private lastMessageAt: number | null = null;
  private lastRttMs: number | null = null;

  private outWindow: number[] = [];
  private inWindow: number[] = [];

  private pingTimer: any = null;
  private reconnectTimer: any = null;
  private reconnectBackoffMs = 500;

  constructor(handlers: Handlers = {}) {
    this.handlers = handlers;
  }

  getSessionId() {
    return this.sessionId;
  }

  getStatus() {
    return this.status;
  }

  connect(): void {
    const wsUrl = getGpuServerWsUrl();
    if (!wsUrl) {
      this.setStatus("disabled");
      return;
    }

    this.cleanup();
    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.reconnectBackoffMs = 500;
        this.setStatus("connected");

        const prefs = getGpuStreamPrefs();
        const hello: GpuStreamClientHello = {
          type: "hello",
          sessionId: this.sessionId,
          client: {
            platform: typeof (window as any).Capacitor !== "undefined" ? "capacitor" : "web",
            userAgent: navigator.userAgent,
          },
          prefs,
        };
        this.ws?.send(JSON.stringify(hello));

        this.startPing();
      };

      this.ws.onmessage = (ev) => {
        this.lastMessageAt = Date.now();
        this.inWindow.push(this.lastMessageAt);
        this.trimWindows();

        let msg: GpuStreamServerMessage | null = null;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          // ignore
        }
        if (!msg) return;

        if ((msg as any).type === "pong") {
          const sentAt = Number((msg as any).sentAt);
          const receivedAt = Number((msg as any).receivedAt ?? this.lastMessageAt);
          if (Number.isFinite(sentAt) && Number.isFinite(receivedAt)) {
            this.lastRttMs = Math.max(0, receivedAt - sentAt);
          }
        }

        if ((msg as any).type === "result") {
          this.handlers.onResult?.(msg as any);
        }

        this.emitPerf((msg as any).serverMs ?? (msg as any).server_ms ?? null);
      };

      this.ws.onerror = () => {
        this.setStatus("error", "WebSocket error");
      };

      this.ws.onclose = () => {
        this.setStatus("disconnected");
        this.stopPing();
        this.scheduleReconnect();
      };
    } catch (e: any) {
      this.setStatus("error", e?.message || "connect failed");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.cleanup();
    this.setStatus("disconnected");
  }

  /**
   * Sends a JPEG data URL frame, throttled by settings max FPS.
   */
  sendFrame(imageJpegDataUrl: string): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.dropped += 1;
      this.emitPerf(null);
      return null;
    }

    const { maxFps } = getGpuStreamPrefs();
    const minGap = 1000 / maxFps;
    const now = Date.now();

    if (now - this.lastSendAt < minGap) {
      this.dropped += 1;
      this.emitPerf(null);
      return null;
    }

    const frameId = safeUUID();
    const payload: GpuStreamClientFrame = {
      type: "frame",
      sessionId: this.sessionId,
      frameId,
      sentAt: now,
      imageJpegDataUrl,
    };

    try {
      this.ws.send(JSON.stringify(payload));
      this.lastSendAt = now;
      this.outWindow.push(now);
      this.trimWindows();
      this.emitPerf(null);
      return frameId;
    } catch {
      this.dropped += 1;
      this.emitPerf(null);
      return null;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const ping: GpuStreamClientPing = { type: "ping", sessionId: this.sessionId, sentAt: Date.now() };
      try {
        this.ws.send(JSON.stringify(ping));
      } catch {
        // ignore
      }
    }, 2500);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect() {
    const wsUrl = getGpuServerWsUrl();
    if (!wsUrl) return;
    if (this.reconnectTimer) return;

    const delay = this.reconnectBackoffMs;
    this.reconnectBackoffMs = Math.min(8000, Math.round(this.reconnectBackoffMs * 1.7));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanup() {
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }

  private setStatus(s: GpuOffloadStatus, err?: string) {
    this.status = s;
    this.handlers.onStatus?.(s, err);
  }

  private trimWindows() {
    const cutoff = Date.now() - 1000;
    this.outWindow = this.outWindow.filter((t) => t >= cutoff);
    this.inWindow = this.inWindow.filter((t) => t >= cutoff);
    this.fpsOut = this.outWindow.length;
    this.fpsIn = this.inWindow.length;
  }

  private emitPerf(serverMs: number | null) {
    this.trimWindows();

    const p: GpuPerfSnapshot = {
      rttMs: this.lastRttMs,
      serverMs: serverMs,
      fpsOut: this.fpsOut,
      fpsIn: this.fpsIn,
      dropped: this.dropped,
      lastMessageAt: this.lastMessageAt,
    };

    this.handlers.onPerf?.(p);
  }
}
