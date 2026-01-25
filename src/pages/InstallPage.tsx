import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Download, 
  Smartphone, 
  Check, 
  Share, 
  MoreVertical, 
  Monitor,
  Wifi,
  Zap,
  Shield,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://")
    ) {
      setIsInstalled(true);
    }

    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isAndroidDevice = /android/.test(userAgent);
    
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);
    setIsDesktop(!isIOSDevice && !isAndroidDevice);

    // Check if we already have a deferred prompt stored globally
    if ((window as any).__pwaInstallPrompt) {
      setDeferredPrompt((window as any).__pwaInstallPrompt);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      (window as any).__pwaInstallPrompt = promptEvent;
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      (window as any).__pwaInstallPrompt = null;
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

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      (window as any).__pwaInstallPrompt = null;
    } finally {
      setInstalling(false);
    }
  };

  const features = [
    { icon: Wifi, text: "Works offline", description: "Access your collection anywhere" },
    { icon: Zap, text: "Lightning fast", description: "Native app performance" },
    { icon: Shield, text: "Secure", description: "Your data is protected" },
  ];

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 safe-area-inset">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="mx-auto mb-6 w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center"
          >
            <Check className="w-10 h-10 text-green-500" />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
            Already Installed!
          </h1>
          <p className="text-muted-foreground mb-6">
            CleanCards is installed on your device. Open it from your home screen for the best experience.
          </p>
          <Button onClick={() => window.location.href = "/"} className="w-full max-w-xs">
            Open App
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-inset">
      {/* Hero section */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center max-w-md w-full"
        >
          {/* App icon */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mx-auto mb-6"
          >
            <img
              src="/pwa-192x192.png"
              alt="CleanCards"
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl shadow-2xl mx-auto"
            />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-2xl sm:text-3xl font-bold text-foreground mb-2"
          >
            Install CleanCards
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground mb-8"
          >
            Add to your home screen for the best experience
          </motion.p>

          {/* Install button or instructions */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            {deferredPrompt ? (
              <Button 
                onClick={handleInstallClick} 
                className="w-full h-14 text-lg font-semibold rounded-xl"
                disabled={installing}
              >
                <Download className="mr-2 h-5 w-5" />
                {installing ? "Installing..." : "Install App"}
              </Button>
            ) : isIOS ? (
              <div className="bg-muted/50 rounded-2xl p-5 text-left">
                <p className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Install on iOS
                </p>
                <ol className="space-y-4">
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Tap the <Share className="inline w-4 h-4 text-primary mx-1" /> <strong>Share</strong> button in Safari
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Scroll and tap <strong>"Add to Home Screen"</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Tap <strong>"Add"</strong> to confirm
                    </span>
                  </li>
                </ol>
              </div>
            ) : isAndroid ? (
              <div className="bg-muted/50 rounded-2xl p-5 text-left">
                <p className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Install on Android
                </p>
                <ol className="space-y-4">
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Tap the <MoreVertical className="inline w-4 h-4 text-primary mx-1" /> <strong>Menu</strong> button in Chrome
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <span className="text-sm text-foreground pt-0.5">
                      Confirm the installation
                    </span>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="text-center">
                <Monitor className="mx-auto h-16 w-16 mb-4 text-muted-foreground/50" />
                <p className="text-muted-foreground">
                  Visit this page on your mobile device to install the app
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* Features section */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="px-6 pb-8 safe-area-bottom"
      >
        <div className="max-w-md mx-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 text-center">
            Why Install?
          </h2>
          <div className="grid gap-3">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.35 + index * 0.1 }}
                className="flex items-center gap-4 bg-muted/30 rounded-xl p-4"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm">{feature.text}</p>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
