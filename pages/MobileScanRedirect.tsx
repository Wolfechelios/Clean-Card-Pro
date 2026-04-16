import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Camera, CheckCircle2 } from "lucide-react";

export default function MobileScanRedirect() {
  const navigate = useNavigate();

  const handleOpenScanner = () => {
    navigate("/mobile-scan");
  };

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Mobile Scanner Ready</CardTitle>
          <CardDescription>
            Use your phone's camera to scan cards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">High Quality Scanning</p>
                <p className="text-muted-foreground">Capture cards with your phone camera</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Secure Connection</p>
                <p className="text-muted-foreground">Make sure you're using HTTPS</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Grant Permissions</p>
                <p className="text-muted-foreground">Allow camera access when prompted</p>
              </div>
            </div>
          </div>

          <Button 
            onClick={handleOpenScanner}
            size="lg" 
            className="w-full"
          >
            <Camera className="mr-2 h-5 w-5" />
            Open Camera Scanner
          </Button>

          <div className="text-xs text-muted-foreground text-center space-y-1 p-3 bg-muted rounded-lg">
            <p className="font-medium">Troubleshooting:</p>
            <p>• Make sure other apps aren't using your camera</p>
            <p>• Try closing and reopening your browser</p>
            <p>• Check that camera permissions are enabled in your device settings</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
