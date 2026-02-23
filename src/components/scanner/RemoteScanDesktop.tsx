import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Smartphone, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface RemoteScanDesktopProps {
  userId: string;
  onImageReceived: (imageFile: File) => void;
}

export const RemoteScanDesktop = ({ userId, onImageReceived }: RemoteScanDesktopProps) => {
  const [sessionCode, setSessionCode] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [lastImageUrl, setLastImageUrl] = useState<string>("");
  const [receivedCount, setReceivedCount] = useState(0);
  const channelRef = useRef<any>(null);

  const generateSession = async () => {
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const { data, error } = await supabase
        .from("remote_scan_sessions")
        .insert({
          user_id: userId,
          session_code: code,
          status: "waiting",
        })
        .select()
        .single();

      if (error) throw error;

      setSessionCode(code);
      setSessionId(data.id);
      setupRealtimeChannel(data.id);
      toast.success("Session created! Scan QR code with your phone");
    } catch (error) {
      console.error("Error creating session:", error);
      toast.error("Failed to create session");
    }
  };

  const setupRealtimeChannel = (sessId: string) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`remote-scan-${sessId}`)
      .on('broadcast', { event: 'camera-frame' }, async (payload: any) => {
        const imageUrl = payload.payload?.imageUrl;
        if (!imageUrl) return;

        try {
          setLastImageUrl(imageUrl);
          setReceivedCount(prev => prev + 1);

          // Download the image from storage and convert to File
          const res = await fetch(imageUrl);
          if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], `remote-${Date.now()}.jpg`, { type: 'image/jpeg' });
          onImageReceived(file);
        } catch (err) {
          console.error("Failed to process remote image:", err);
          toast.error("Failed to process received photo");
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
      .subscribe();

    channelRef.current = channel;
  };

  const refreshSession = () => {
    setSessionCode("");
    setSessionId("");
    setIsConnected(false);
    setLastImageUrl("");
    setReceivedCount(0);
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    generateSession();
  };

  useEffect(() => {
    generateSession();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (sessionId) {
        supabase.from("remote_scan_sessions").delete().eq("id", sessionId);
      }
    };
  }, []);

  const appUrl = window.location.origin;
  const qrValue = `${appUrl}/scan?remote=${sessionCode}`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Remote Phone Camera</CardTitle>
            <CardDescription>
              {isConnected 
                ? `Phone connected — ${receivedCount} photo${receivedCount !== 1 ? 's' : ''} received`
                : "Scan this QR code with your phone to use its camera"
              }
            </CardDescription>
          </div>
          <Button onClick={refreshSession} variant="outline" size="icon" aria-label="Refresh QR code session">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
              <div className="bg-white p-6 rounded-lg shadow-lg">
                <QRCodeSVG value={qrValue} size={256} level="H" />
              </div>
              
              <div className="text-center space-y-2">
                <p className="text-2xl font-bold tracking-wider">{sessionCode}</p>
                <p className="text-sm text-muted-foreground">
                  Or manually enter this code on your phone
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isConnected ? (
                  <>
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium text-green-600">Phone Connected</span>
                  </>
                ) : (
                  <>
                    <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground">Waiting for phone...</span>
                  </>
                )}
              </div>
            </div>

            {lastImageUrl && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Last Received Photo</h3>
                <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
                  <img 
                    src={lastImageUrl} 
                    alt="Phone camera feed" 
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-start gap-3">
                <Smartphone className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">How to connect:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Open this app on your phone</li>
                    <li>Go to Scan page and tap "Remote Camera"</li>
                    <li>Scan the QR code or enter the code above</li>
                    <li>Take photos — they'll be scanned here automatically!</li>
                  </ol>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
