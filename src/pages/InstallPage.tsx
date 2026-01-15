import { useState, useEffect } from "react";
import { Download, Smartphone, Check, Share, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));
    setIsAndroid(/android/.test(userAgent));

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Already Installed!</CardTitle>
            <CardDescription>
              CleanCards is installed on your device. Open it from your home screen for the best experience.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img
              src="/pwa-192x192.png"
              alt="CleanCards"
              className="w-24 h-24 rounded-2xl shadow-lg"
            />
          </div>
          <CardTitle className="text-2xl">Install CleanCards</CardTitle>
          <CardDescription>
            Add CleanCards to your home screen for quick access and offline support
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deferredPrompt ? (
            <Button onClick={handleInstallClick} className="w-full" size="lg">
              <Download className="mr-2 h-5 w-5" />
              Install App
            </Button>
          ) : isIOS ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-foreground">To install on iOS:</p>
              <ol className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">1</span>
                  <span>Tap the <Share className="inline w-4 h-4" /> Share button in Safari</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">2</span>
                  <span>Scroll down and tap "Add to Home Screen"</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">3</span>
                  <span>Tap "Add" to confirm</span>
                </li>
              </ol>
            </div>
          ) : isAndroid ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-foreground">To install on Android:</p>
              <ol className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">1</span>
                  <span>Tap the <MoreVertical className="inline w-4 h-4" /> menu button</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">2</span>
                  <span>Tap "Install app" or "Add to Home screen"</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">3</span>
                  <span>Confirm the installation</span>
                </li>
              </ol>
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              <Smartphone className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>Visit this page on your mobile device to install the app</p>
            </div>
          )}

          <div className="pt-4 border-t space-y-2">
            <h4 className="font-medium text-sm">Why install?</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>✓ Works offline</li>
              <li>✓ Faster loading</li>
              <li>✓ Quick access from home screen</li>
              <li>✓ Full-screen experience</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
