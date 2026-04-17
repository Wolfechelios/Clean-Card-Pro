import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Camera, Loader2, QrCode, SwitchCamera, X, Zap, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import QrScanner from "react-qr-scanner";
import { useScannerSettings } from "@/hooks/use-scanner-settings";

interface RemoteScanMobileProps {
  userId: string;
}

export const RemoteScanMobile = ({ userId }: RemoteScanMobileProps) => {
  const { settings } = useScannerSettings();
  const [mode, setMode] = useState<'scan' | 'manual' | 'camera'>('scan');
  const [sessionCode, setSessionCode] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const cameraFacing = 'environment' as const;
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'capturing' | 'uploading' | 'complete'>('idle');
  const [progressPercent, setProgressPercent] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [burstMode, setBurstMode] = useState(false);
  const [burstQueue, setBurstQueue] = useState(0);
  const [connectionHealth, setConnectionHealth] = useState<'good' | 'weak' | 'lost'>('good');
  // Remote-overridable settings (received via realtime broadcast from desktop)
  const [imageQuality, setImageQuality] = useState<'low' | 'medium' | 'high'>(settings.remotePhoneImageQuality);
  const [burstIntervalSec, setBurstIntervalSec] = useState<number>(settings.remoteBurstIntervalSec);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);
  const burstActiveRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageQualityRef = useRef(imageQuality);
  const burstIntervalRef = useRef(burstIntervalSec);
  imageQualityRef.current = imageQuality;
  burstIntervalRef.current = burstIntervalSec;

  const connectToSession = async (code: string) => {
    setIsConnecting(true);
    try {
      const { data: session, error } = await supabase
        .from("remote_scan_sessions")
        .select("*")
        .eq("session_code", code.toUpperCase())
        .eq("status", "waiting")
        .single();

      if (error || !session) {
        throw new Error("Invalid session code or session expired");
      }

      await supabase
        .from("remote_scan_sessions")
        .update({ 
          status: "connected",
          phone_connected_at: new Date().toISOString()
        })
        .eq("id", session.id);

      setSessionId(session.id);
      setIsConnected(true);
      setupRealtimeChannel(session.id);
      startHeartbeat(session.id);
      setMode('camera');
      toast.success("Connected to computer!");
    } catch (error: any) {
      console.error("Connection error:", error);
      toast.error(error.message || "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  const setupRealtimeChannel = (sessId: string) => {
    const channel = supabase.channel(`remote-scan-${sessId}`)
      .on('broadcast', { event: 'ack' }, () => {
        // Desktop acknowledged receipt
        setConnectionHealth('good');
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ device: 'phone', userId });
        }
      });

    channelRef.current = channel;
  };

  const startHeartbeat = (sessId: string) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      try {
        await supabase
          .from("remote_scan_sessions")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", sessId);
      } catch {
        setConnectionHealth('weak');
      }
    }, 15000);
  };

  const startCamera = async (facing: 'environment' = 'environment') => {
    try {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        toast.error("Camera requires HTTPS connection.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Camera not supported in this browser");
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        try { await videoRef.current.play(); } catch {}
        streamRef.current = stream;
        // rear-only, no facing state to update
      }
    } catch (error: any) {
      console.error("Camera error:", error);
      if (error.name === 'NotAllowedError') {
        toast.error("Camera permission denied.");
      } else if (error.name === 'NotFoundError') {
        toast.error("No camera found on this device");
      } else {
        toast.error("Failed to access camera: " + error.message);
      }
    }
  };

  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!videoRef.current) return null;

    const canvas = document.createElement('canvas');
    const vw = videoRef.current.videoWidth;
    const vh = videoRef.current.videoHeight;
    canvas.width = vw;
    canvas.height = vh;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(videoRef.current, 0, 0, vw, vh);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.90);
    });
    if (!blob) return null;

    const fileName = `remote/${sessionId}/${Date.now()}-${Math.random().toString(36).substring(2, 6)}.jpg`;
    const { error } = await supabase.storage
      .from('card-images')
      .upload(fileName, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    const { data: { publicUrl } } = supabase.storage
      .from('card-images')
      .getPublicUrl(fileName);

    return publicUrl;
  }, [sessionId]);

  const captureAndSend = async () => {
    if (!videoRef.current || !channelRef.current) {
      toast.error("Camera or connection not ready");
      return;
    }

    try {
      setUploadProgress('capturing');
      setProgressPercent(20);

      const imageUrl = await captureFrame();
      if (!imageUrl) throw new Error("Capture failed");

      setUploadProgress('uploading');
      setProgressPercent(70);

      await channelRef.current.send({
        type: 'broadcast',
        event: 'camera-frame',
        payload: { imageUrl, timestamp: Date.now() },
      });

      setProgressPercent(100);
      setUploadProgress('complete');
      setSentCount(prev => prev + 1);

      setTimeout(() => {
        setUploadProgress('idle');
        setProgressPercent(0);
      }, 800);
    } catch (error: any) {
      console.error("Error capturing and sending:", error);
      toast.error(error.message || "Failed to send photo");
      setUploadProgress('idle');
      setProgressPercent(0);
    }
  };

  const startBurst = async () => {
    if (burstActiveRef.current) return;
    burstActiveRef.current = true;
    setBurstMode(true);
    toast("Burst mode started — tap Stop when done", { duration: 2000 });

    let count = 0;
    while (burstActiveRef.current && channelRef.current) {
      try {
        setBurstQueue(prev => prev + 1);
        const imageUrl = await captureFrame();
        if (!imageUrl) break;

        await channelRef.current.send({
          type: 'broadcast',
          event: 'camera-frame',
          payload: { imageUrl, timestamp: Date.now(), burst: true },
        });

        count++;
        setSentCount(prev => prev + 1);
        setBurstQueue(prev => Math.max(0, prev - 1));

        // Small delay between burst captures (500ms)
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error("Burst capture error:", err);
        setBurstQueue(prev => Math.max(0, prev - 1));
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setBurstMode(false);
    setBurstQueue(0);
    if (count > 0) {
      toast.success(`Burst complete — ${count} photos sent`);
    }
  };

  const stopBurst = () => {
    burstActiveRef.current = false;
  };

  // Front camera disabled — only rear camera allowed

  const disconnect = () => {
    burstActiveRef.current = false;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (sessionId) {
      supabase.from("remote_scan_sessions").update({ status: "disconnected" }).eq("id", sessionId);
    }
    setIsConnected(false);
    setMode('scan');
    setSessionCode("");
    setSentCount(0);
    setConnectionHealth('good');
  };

  useEffect(() => {
    if (mode === 'camera' && isConnected) startCamera();
    return () => {
      burstActiveRef.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [mode, isConnected]);

  const handleQrScan = (data: any) => {
    if (data) {
      try {
        const url = new URL(data.text || data);
        const code = url.searchParams.get('remote');
        if (code) {
          setSessionCode(code);
          connectToSession(code);
        }
      } catch { /* not a URL */ }
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Connect to Computer</CardTitle>
            <CardDescription>
              {mode === 'scan' && "Scan QR code or enter session code"}
              {mode === 'manual' && "Enter the session code from your computer"}
              {mode === 'camera' && `Connected — ${sentCount} photo${sentCount !== 1 ? 's' : ''} sent`}
            </CardDescription>
          </div>
          {mode === 'camera' && (
            <Badge variant={connectionHealth === 'good' ? 'default' : 'destructive'} className="flex items-center gap-1">
              {connectionHealth === 'good' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connectionHealth === 'good' ? 'Connected' : 'Weak'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Scan mode */}
        {mode === 'scan' && !isConnected && (
          <>
            <div className="aspect-square bg-black rounded-lg overflow-hidden">
              <QrScanner
                delay={300}
                onError={(e: any) => console.error("QR error:", e)}
                onScan={handleQrScan}
                constraints={{ video: { facingMode: 'environment' } }}
                style={{ width: '100%' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t" />
              <span className="text-sm text-muted-foreground">OR</span>
              <div className="flex-1 border-t" />
            </div>
            <Button onClick={() => setMode('manual')} variant="outline" className="w-full">
              Enter Code Manually
            </Button>
          </>
        )}

        {/* Manual code entry */}
        {mode === 'manual' && !isConnected && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Session Code</Label>
              <Input
                id="code"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="text-center text-2xl font-bold tracking-wider uppercase"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => connectToSession(sessionCode)}
                disabled={sessionCode.length !== 6 || isConnecting}
                className="flex-1"
              >
                {isConnecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : "Connect"}
              </Button>
              <Button onClick={() => setMode('scan')} variant="outline">
                <QrCode className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Camera mode */}
        {mode === 'camera' && isConnected && (
          <div className="space-y-4">
            <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {/* Front camera toggle removed — rear only */}

              {burstMode && (
                <div className="absolute top-3 left-3">
                  <Badge variant="destructive" className="animate-pulse flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    Burst {burstQueue > 0 && `(${burstQueue})`}
                  </Badge>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {uploadProgress !== 'idle' && !burstMode && (
              <div className="space-y-1">
                <Progress value={progressPercent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {uploadProgress === 'capturing' && 'Capturing...'}
                  {uploadProgress === 'uploading' && 'Uploading...'}
                  {uploadProgress === 'complete' && '✅ Sent!'}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              {burstMode ? (
                <Button onClick={stopBurst} variant="destructive" size="lg" className="col-span-2">
                  <X className="mr-2 h-5 w-5" />
                  Stop Burst ({sentCount})
                </Button>
              ) : (
                <>
                  <Button
                    onClick={captureAndSend}
                    size="lg"
                    disabled={uploadProgress !== 'idle'}
                  >
                    <Camera className="mr-2 h-5 w-5" />
                    Send Photo
                  </Button>
                  <Button
                    onClick={startBurst}
                    size="lg"
                    variant="secondary"
                    disabled={uploadProgress !== 'idle'}
                  >
                    <Zap className="mr-2 h-5 w-5" />
                    Burst Mode
                  </Button>
                </>
              )}
            </div>

            <Button onClick={disconnect} variant="outline" className="w-full">
              <X className="mr-2 h-4 w-4" />
              Disconnect
            </Button>

            {uploadProgress === 'idle' && !burstMode && (
              <p className="text-xs text-center text-muted-foreground">
                Single tap to send one photo, or use Burst Mode to continuously capture
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
