import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Smartphone, RefreshCw, CheckCircle2, AlertCircle, ImageIcon, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { idbAdd } from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { compressImageForQueue } from "@/lib/imageCompressor";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { playShutterBeep } from "@/lib/audioBeeps";

interface RemoteScanDesktopProps {
  userId: string;
  onImageReceived: (imageFile: File) => void;
}

interface ReceivedPhoto {
  id: string;
  imageUrl: string;
  timestamp: number;
  status: 'received' | 'queued' | 'processing' | 'done' | 'error';
}

export const RemoteScanDesktop = ({ userId, onImageReceived }: RemoteScanDesktopProps) => {
  const { settings } = useScannerSettings();
  const [sessionCode, setSessionCode] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [receivedPhotos, setReceivedPhotos] = useState<ReceivedPhoto[]>([]);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number>(0);
  const channelRef = useRef<any>(null);
  const sessionIdRef = useRef<string>("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const { queueCount, processedCount, isRunning, start: startProcessor } = useQueueProcessor();

  const totalReceived = receivedPhotos.length;

  const queueImageForProcessing = useCallback(async (imageUrl: string, photoId: string) => {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const blob = await res.blob();

      const compressed = await compressImageForQueue(blob);

      await idbAdd({
        id: photoId,
        createdAt: Date.now(),
        status: 'queued',
        blob: compressed,
        mime: 'image/jpeg',
        filename: `remote-${photoId}.jpg`,
      });

      const file = new File([compressed], `remote-${photoId}.jpg`, { type: 'image/jpeg' });
      onImageReceived(file);

      setReceivedPhotos(prev =>
        prev.map(p => p.id === photoId ? { ...p, status: 'queued' } : p)
      );

      if (!isRunning) {
        startProcessor();
      }
    } catch (err) {
      console.error("Failed to queue image:", err);
      setReceivedPhotos(prev =>
        prev.map(p => p.id === photoId ? { ...p, status: 'error' } : p)
      );
    }
  }, [onImageReceived, isRunning, startProcessor]);

  const queueAllReceived = useCallback(() => {
    const pending = receivedPhotos.filter(p => p.status === 'received');
    if (pending.length === 0) {
      toast.info("No photos waiting to be queued");
      return;
    }
    pending.forEach(p => queueImageForProcessing(p.imageUrl, p.id));
    toast.success(`Queued ${pending.length} photo${pending.length !== 1 ? 's' : ''}`);
  }, [receivedPhotos, queueImageForProcessing]);

  const setupRealtimeChannel = useCallback((sessId: string) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`remote-scan-${sessId}`)
      .on('broadcast', { event: 'camera-frame' }, async (payload: any) => {
        const imageUrl = payload.payload?.imageUrl;
        if (!imageUrl) return;

        const currentSettings = settingsRef.current;
        const photoId = `remote-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const initialStatus: ReceivedPhoto['status'] = currentSettings.remoteAutoQueue ? 'queued' : 'received';
        const photo: ReceivedPhoto = {
          id: photoId,
          imageUrl,
          timestamp: payload.payload?.timestamp || Date.now(),
          status: initialStatus,
        };

        setReceivedPhotos(prev => [photo, ...prev].slice(0, 50));

        // Sound feedback
        if (currentSettings.remoteSoundOnReceive) {
          try { playShutterBeep(); } catch {}
        }

        // Send ack to phone
        try {
          await channel.send({
            type: 'broadcast',
            event: 'ack',
            payload: { photoId, timestamp: Date.now() },
          });
        } catch {}

        if (currentSettings.remoteAutoQueue) {
          queueImageForProcessing(imageUrl, photoId);
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const hasPhone = Object.keys(state).some(key => {
          const presences = state[key] as any[];
          return presences?.[0]?.device === 'phone';
        });
        setIsConnected(hasPhone);
        if (hasPhone) {
          toast.success("Phone connected!");
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Broadcast settings to the phone so it can adapt quality / burst interval
          try {
            await channel.send({
              type: 'broadcast',
              event: 'settings',
              payload: {
                imageQuality: settingsRef.current.remotePhoneImageQuality,
                burstIntervalSec: settingsRef.current.remoteBurstIntervalSec,
              },
            });
          } catch {}
        }
      });

    channelRef.current = channel;
  }, [queueImageForProcessing]);

  const generateSession = useCallback(async () => {
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const timeoutMin = settingsRef.current.remoteSessionTimeoutMin || 30;
      const expiresAt = new Date(Date.now() + timeoutMin * 60 * 1000);

      const { data, error } = await supabase
        .from("remote_scan_sessions")
        .insert({
          user_id: userId,
          session_code: code,
          status: "waiting",
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      setSessionCode(code);
      setSessionId(data.id);
      setSessionExpiresAt(expiresAt.getTime());
      sessionIdRef.current = data.id;
      setupRealtimeChannel(data.id);
      toast.success("Session created! Scan QR code with your phone");
    } catch (error) {
      console.error("Error creating session:", error);
      toast.error("Failed to create session");
    }
  }, [userId, setupRealtimeChannel]);

  const refreshSession = () => {
    setSessionCode("");
    setSessionId("");
    sessionIdRef.current = "";
    setIsConnected(false);
    setReceivedPhotos([]);
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    generateSession();
  };

  useEffect(() => {
    generateSession();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (sessionIdRef.current) {
        supabase.from("remote_scan_sessions").delete().eq("id", sessionIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expire idle session
  useEffect(() => {
    if (!sessionExpiresAt || isConnected) return;
    const ms = sessionExpiresAt - Date.now();
    if (ms <= 0) {
      refreshSession();
      return;
    }
    const t = setTimeout(() => {
      if (!isConnected) {
        toast.info("Session expired — generating a new code");
        refreshSession();
      }
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpiresAt, isConnected]);

  const appUrl = window.location.origin;
  const qrValue = sessionCode ? `${appUrl}/scan?remote=${sessionCode}` : '';

  const pendingManualCount = receivedPhotos.filter(p => p.status === 'received').length;

  return (
    <div id="remote" className="space-y-4 scroll-mt-20">
      <Card className="shadow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Remote Phone Camera
                {isConnected && (
                  <Badge variant="default" className="text-xs">Live</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {isConnected
                  ? `Phone connected — ${totalReceived} photo${totalReceived !== 1 ? 's' : ''} received`
                  : "Scan this QR code with your phone to use its camera"
                }
              </CardDescription>
            </div>
            <Button onClick={refreshSession} variant="outline" size="icon" aria-label="Refresh session">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!sessionCode ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-4">
                {!isConnected && (
                  <div className="bg-white p-6 rounded-lg shadow-lg">
                    <QRCodeSVG value={qrValue} size={220} level="H" />
                  </div>
                )}

                <div className="text-center space-y-1">
                  <p className="text-2xl font-bold tracking-wider font-mono">{sessionCode}</p>
                  <p className="text-xs text-muted-foreground">
                    {isConnected ? "Session active" : "Enter this code on your phone"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-medium text-green-600 dark:text-green-400">Phone Connected</span>
                    </>
                  ) : (
                    <>
                      <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                      <span className="text-sm text-muted-foreground">Waiting for phone...</span>
                    </>
                  )}
                </div>
              </div>

              {/* Manual queue button when auto-queue disabled */}
              {!settings.remoteAutoQueue && pendingManualCount > 0 && (
                <Button onClick={queueAllReceived} className="w-full" size="lg">
                  <ListPlus className="h-4 w-4 mr-2" />
                  Queue all received photos ({pendingManualCount})
                </Button>
              )}

              {/* Processing queue status */}
              {totalReceived > 0 && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Processing Queue</span>
                    <span className="text-muted-foreground tabular-nums">
                      {processedCount} / {totalReceived} scanned
                    </span>
                  </div>
                  <Progress value={totalReceived > 0 ? (processedCount / totalReceived) * 100 : 0} className="h-2" />
                  {queueCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {queueCount} in queue • {isRunning ? "Processing..." : "Paused"}
                    </p>
                  )}
                </div>
              )}

              {!isConnected && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Smartphone className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">How to connect:</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Open this app on your phone</li>
                        <li>Go to Scan → Remote tab</li>
                        <li>Scan QR or enter code above</li>
                        <li>
                          {settings.remoteAutoQueue
                            ? "Photos auto-queue for scanning!"
                            : "Photos arrive here — tap “Queue all” to scan"}
                        </li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Received photos feed */}
      {settings.remoteShowPhotoGrid && receivedPhotos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Received Photos ({receivedPhotos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {receivedPhotos.slice(0, 24).map((photo) => (
                <div key={photo.id} className="relative aspect-[3/4] rounded-md overflow-hidden border bg-muted">
                  <img
                    src={photo.imageUrl}
                    alt="Remote card"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 inset-x-0 p-0.5 flex justify-center">
                    {photo.status === 'received' && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-background/80">Pending</Badge>
                    )}
                    {photo.status === 'queued' && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">Queued</Badge>
                    )}
                    {photo.status === 'done' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500 drop-shadow" />
                    )}
                    {photo.status === 'error' && (
                      <AlertCircle className="h-4 w-4 text-destructive drop-shadow" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
