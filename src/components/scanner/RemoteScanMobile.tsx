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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);

  const connectToSession = async (code: string) => {
    setIsConnecting(true);
    try {
      // Find session by code
      const { data: session, error } = await supabase
        .from("remote_scan_sessions")
        .select("*")
        .eq("session_code", code.toUpperCase())
        .eq("status", "waiting")
        .single();

      if (error || !session) {
        throw new Error("Invalid session code");
      }

      // Update session status
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
          // Announce presence as phone
          await channel.track({ device: 'phone', userId });
        }
      });

    channelRef.current = channel;
  };

  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    try {
      console.log("Starting camera with facing:", facing);
      
      // Check if HTTPS or localhost
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        toast.error("Camera requires HTTPS connection. Please use a secure connection.");
        return;
      }

      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error("Camera not supported in this browser");
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      console.log("Requesting camera access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing === 'environment' ? { exact: 'environment' } : { exact: 'user' },
          width: { ideal: 3840, min: 1920 },
          height: { ideal: 2160, min: 1080 },
          aspectRatio: { ideal: 16/9 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      console.log("Camera access granted, stream received");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        
        // Explicitly play the video for mobile browsers
        try {
          await videoRef.current.play();
          console.log("Video playback started");
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
        toast.error("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (error.name === 'NotFoundError') {
        toast.error("No camera found on this device");
      } else if (error.name === 'NotReadableError') {
        toast.error("Camera is already in use by another application");
      } else if (error.name === 'NotSupportedError') {
        toast.error("Camera not supported. Try using HTTPS.");
      } else {
        toast.error("Failed to access camera: " + error.message);
      }
    }
  };

  const captureAndSend = async () => {
    if (!videoRef.current || !channelRef.current) return;

    try {
      // Stage 1: Capturing (0-33%)
      setUploadProgress('capturing');
      setProgressPercent(10);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Create high-resolution canvas
      const canvas = document.createElement('canvas');
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;
      
      // Use full video resolution or higher
      canvas.width = Math.max(videoWidth, 3840);
      canvas.height = Math.max(videoHeight, 2160);
      
      const ctx = canvas.getContext('2d', { 
        alpha: false,
        desynchronized: true,
        willReadFrequently: false
      });
      if (!ctx) return;

      setProgressPercent(20);
      
      // Optimize canvas rendering for quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Scale and draw with high quality
      const scale = Math.min(canvas.width / videoWidth, canvas.height / videoHeight);
      const x = (canvas.width - videoWidth * scale) / 2;
      const y = (canvas.height - videoHeight * scale) / 2;
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoRef.current, x, y, videoWidth * scale, videoHeight * scale);
      
      // Stage 2: Processing (33-66%)
      setUploadProgress('processing');
      setProgressPercent(40);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Maximum JPEG quality
      const imageData = canvas.toDataURL('image/jpeg', 1.0);
      
      setProgressPercent(60);
      
      // Stage 3: Uploading (66-100%)
      setUploadProgress('uploading');
      setProgressPercent(75);
      
      await channelRef.current.send({
        type: 'broadcast',
        event: 'camera-frame',
        payload: { imageData }
      });

      // Complete
      setProgressPercent(100);
      setUploadProgress('complete');
      
      toast.success("Photo sent to computer!");
      
      // Reset after brief delay
      setTimeout(() => {
        setUploadProgress('idle');
        setProgressPercent(0);
      }, 1500);
    } catch (error) {
      console.error("Error capturing and sending:", error);
      toast.error("Failed to send photo");
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
      const url = new URL(data.text || data);
      const code = url.searchParams.get('remote');
      if (code) {
        setSessionCode(code);
        connectToSession(code);
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
          {mode === 'camera' && "Connected - Take photos to send to computer"}
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
              
              {/* Camera controls overlay */}
              <Button
                onClick={toggleCamera}
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4 rounded-full bg-black/70 hover:bg-black/80"
              >
                <SwitchCamera className="h-5 w-5 text-white" />
              </Button>
            </div>

            {/* Progress indicator */}
            {uploadProgress !== 'idle' && (
              <div className="space-y-2">
                <Progress value={progressPercent} className="h-3" />
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground font-medium">
                    {uploadProgress === 'capturing' && '📸 Capturing photo...'}
                    {uploadProgress === 'processing' && '⚙️ Processing image...'}
                    {uploadProgress === 'uploading' && '📤 Uploading to PC...'}
                    {uploadProgress === 'complete' && '✅ Complete!'}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {progressPercent}%
                  </span>
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Est. time: ~{uploadProgress === 'complete' ? '0' : '1-2'}s
                </p>
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
                  Photos will be sent to your computer for scanning
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
