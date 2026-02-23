import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Camera, Loader2, QrCode, SwitchCamera, X } from "lucide-react";
import { toast } from "sonner";
import QrScanner from "react-qr-scanner";

interface RemoteScanMobileProps {
  userId: string;
}

export const RemoteScanMobile = ({ userId }: RemoteScanMobileProps) => {
  const [mode, setMode] = useState<'scan' | 'manual' | 'camera'>('scan');
  const [sessionCode, setSessionCode] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'capturing' | 'processing' | 'uploading' | 'complete'>('idle');
  const [progressPercent, setProgressPercent] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);

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
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ device: 'phone', userId });
        }
      });

    channelRef.current = channel;
  };

  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    try {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        toast.error("Camera requires HTTPS connection.");
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
        try {
          await videoRef.current.play();
        } catch (playError) {
          console.error("Video play error:", playError);
        }
        streamRef.current = stream;
        setCameraFacing(facing);
        toast.success("Camera ready!");
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

  const captureAndSend = async () => {
    if (!videoRef.current || !channelRef.current) {
      toast.error("Camera or connection not ready");
      return;
    }

    try {
      // Stage 1: Capturing
      setUploadProgress('capturing');
      setProgressPercent(10);

      const canvas = document.createElement('canvas');
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;

      // Use actual video resolution (no upscaling)
      canvas.width = videoWidth;
      canvas.height = videoHeight;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      ctx.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);

      setUploadProgress('processing');
      setProgressPercent(30);

      // Convert to blob (high quality JPEG, ~200-800KB typically)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
          'image/jpeg',
          0.92
        );
      });

      setProgressPercent(50);

      // Stage 2: Upload to Supabase Storage
      setUploadProgress('uploading');
      const fileName = `remote/${sessionId}/${Date.now()}-${Math.random().toString(36).substring(2, 6)}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('card-images')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setProgressPercent(80);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('card-images')
        .getPublicUrl(fileName);

      // Stage 3: Broadcast just the URL (tiny payload)
      await channelRef.current.send({
        type: 'broadcast',
        event: 'camera-frame',
        payload: { 
          imageUrl: publicUrl,
          storagePath: fileName,
          timestamp: Date.now(),
        },
      });

      setProgressPercent(100);
      setUploadProgress('complete');
      setSentCount(prev => prev + 1);
      toast.success("Photo sent to computer!");

      setTimeout(() => {
        setUploadProgress('idle');
        setProgressPercent(0);
      }, 1200);
    } catch (error: any) {
      console.error("Error capturing and sending:", error);
      toast.error(error.message || "Failed to send photo");
      setUploadProgress('idle');
      setProgressPercent(0);
    }
  };

  const toggleCamera = () => {
    const newMode = cameraFacing === 'environment' ? 'user' : 'environment';
    startCamera(newMode);
  };

  const disconnect = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    if (sessionId) {
      supabase.from("remote_scan_sessions")
        .update({ status: "disconnected" })
        .eq("id", sessionId);
    }
    setIsConnected(false);
    setMode('scan');
    setSessionCode("");
    setSentCount(0);
  };

  useEffect(() => {
    if (mode === 'camera' && isConnected) {
      startCamera();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
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
      } catch {
        // Not a valid URL, ignore
      }
    }
  };

  const handleQrError = (error: any) => {
    console.error("QR scan error:", error);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Connect to Computer</CardTitle>
        <CardDescription>
          {mode === 'scan' && "Scan QR code or enter session code"}
          {mode === 'manual' && "Enter the session code from your computer"}
          {mode === 'camera' && `Connected — ${sentCount} photo${sentCount !== 1 ? 's' : ''} sent`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'scan' && !isConnected && (
          <>
            <div className="aspect-square bg-black rounded-lg overflow-hidden">
              <QrScanner
                delay={300}
                onError={handleQrError}
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

            <Button 
              onClick={() => setMode('manual')} 
              variant="outline" 
              className="w-full"
            >
              Enter Code Manually
            </Button>
          </>
        )}

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
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
              <Button 
                onClick={() => setMode('scan')} 
                variant="outline"
              >
                <QrCode className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {mode === 'camera' && isConnected && (
          <div className="space-y-4">
            <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              
              <Button
                onClick={toggleCamera}
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4 rounded-full bg-black/70 hover:bg-black/80"
              >
                <SwitchCamera className="h-5 w-5 text-white" />
              </Button>
            </div>

            {uploadProgress !== 'idle' && (
              <div className="space-y-2">
                <Progress value={progressPercent} className="h-3" />
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground font-medium">
                    {uploadProgress === 'capturing' && '📸 Capturing...'}
                    {uploadProgress === 'processing' && '⚙️ Processing...'}
                    {uploadProgress === 'uploading' && '📤 Uploading...'}
                    {uploadProgress === 'complete' && '✅ Sent!'}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {progressPercent}%
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button 
                onClick={captureAndSend} 
                size="lg" 
                className="flex-1"
                disabled={uploadProgress !== 'idle'}
              >
                <Camera className="mr-2 h-5 w-5" />
                Send Photo
              </Button>
              <Button onClick={disconnect} variant="outline" size="lg">
                <X className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </div>

            {uploadProgress === 'idle' && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm text-center">
                <p className="text-muted-foreground">
                  Photos upload to storage, then the computer scans them
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
