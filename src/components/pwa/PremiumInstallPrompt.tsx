import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Download, 
  X, 
  Share, 
  MoreVertical,
  Sparkles,
  Wifi,
  Zap,
  Bell,
  Camera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PremiumInstallPromptProps {
  className?: string;
  variant?: "banner" | "modal" | "fullscreen";
}

export function PremiumInstallPrompt({ 
  className,
  variant = "banner" 
}: PremiumInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Check if already installed
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes("android-app://");

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check if previously dismissed
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        setIsDismissed(true);
        return;
      }
    }

    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      setPlatform("ios");
      setTimeout(() => setIsVisible(true), 3000);
    } else if (/android/.test(userAgent)) {
      setPlatform("android");
    } else {
      setPlatform("desktop");
    }

    // Check for stored prompt
    if ((window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent }).__pwaInstallPrompt) {
      setDeferredPrompt((window as unknown as { __pwaInstallPrompt: BeforeInstallPromptEvent }).__pwaInstallPrompt);
      setTimeout(() => setIsVisible(true), 2000);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      (window as unknown as { __pwaInstallPrompt: BeforeInstallPromptEvent }).__pwaInstallPrompt = promptEvent;
      setTimeout(() => setIsVisible(true), 2000);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsVisible(false);
      setDeferredPrompt(null);
      (window as unknown as { __pwaInstallPrompt: null }).__pwaInstallPrompt = null;
      localStorage.removeItem("pwa-install-dismissed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          setIsInstalled(true);
          setIsVisible(false);
        }
      } finally {
        setInstalling(false);
        setDeferredPrompt(null);
        (window as unknown as { __pwaInstallPrompt: null }).__pwaInstallPrompt = null;
      }
    } else if (platform === "ios" || platform === "android") {
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  const features = [
    { icon: Camera, text: "Instant card scanning" },
    { icon: Wifi, text: "Works offline" },
    { icon: Zap, text: "Lightning fast" },
    { icon: Bell, text: "Price alerts" },
  ];

  if (isInstalled || isDismissed || !isVisible) {
    return null;
  }

  if (variant === "fullscreen") {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "hsl(220 20% 4% / 0.95)" }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="max-w-md w-full"
          >
            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-muted/50 transition-colors"
              style={{ color: "hsl(215 20% 55%)" }}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Content */}
            <div className="text-center">
              {/* Animated icon */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.1 }}
                className="mx-auto mb-6 relative"
              >
                <div 
                  className="w-24 h-24 rounded-3xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, hsl(173 80% 50% / 0.2), hsl(262 83% 58% / 0.15))",
                    boxShadow: "0 20px 40px hsl(173 80% 50% / 0.15)"
                  }}
                >
                  <Sparkles className="w-12 h-12" style={{ color: "hsl(173 80% 50%)" }} />
                </div>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-[-4px] rounded-3xl opacity-50"
                  style={{
                    background: "linear-gradient(135deg, hsl(173 80% 50%), transparent, hsl(262 83% 58%))",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                    padding: "2px"
                  }}
                />
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-2xl sm:text-3xl font-bold mb-3"
                style={{ color: "hsl(210 40% 98%)" }}
              >
                Get the Full Experience
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-base mb-8"
                style={{ color: "hsl(215 20% 55%)" }}
              >
                Install CleanCards for instant access and premium features
              </motion.p>

              {/* Features grid */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="grid grid-cols-2 gap-3 mb-8"
              >
                {features.map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                    className="flex items-center gap-3 p-3 rounded-xl text-left"
                    style={{ background: "hsl(220 18% 10%)" }}
                  >
                    <div 
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "hsl(173 80% 50% / 0.1)" }}
                    >
                      <feature.icon className="w-4 h-4" style={{ color: "hsl(173 80% 50%)" }} />
                    </div>
                    <span className="text-sm font-medium" style={{ color: "hsl(210 40% 98%)" }}>
                      {feature.text}
                    </span>
                  </motion.div>
                ))}
              </motion.div>

              {/* Install button */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button
                  onClick={handleInstall}
                  disabled={installing}
                  className="w-full h-14 text-lg font-semibold rounded-xl"
                  style={{
                    background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(173 80% 40%))",
                    color: "hsl(220 20% 4%)",
                    boxShadow: "0 10px 30px hsl(173 80% 50% / 0.3)"
                  }}
                >
                  <Download className="mr-2 h-5 w-5" />
                  {installing ? "Installing..." : platform === "ios" ? "How to Install" : "Install App"}
                </Button>

                <button
                  onClick={handleDismiss}
                  className="mt-4 text-sm hover:underline"
                  style={{ color: "hsl(215 20% 55%)" }}
                >
                  Maybe later
                </button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <>
      {/* Banner variant */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "fixed bottom-4 left-4 right-4 z-50 safe-area-bottom",
              "sm:left-auto sm:right-4 sm:max-w-sm",
              className
            )}
          >
            <div 
              className="rounded-2xl overflow-hidden"
              style={{
                background: "linear-gradient(135deg, hsl(220 18% 10%), hsl(220 18% 8%))",
                border: "1px solid hsl(220 13% 18%)",
                boxShadow: "0 20px 40px hsl(0 0% 0% / 0.5)"
              }}
            >
              {/* Gradient accent line */}
              <div 
                className="h-1"
                style={{
                  background: "linear-gradient(90deg, hsl(173 80% 50%), hsl(262 83% 58%))"
                }}
              />

              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 p-1 rounded-full transition-colors"
                style={{ color: "hsl(215 20% 55%)" }}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="p-4">
                <div className="flex items-start gap-4">
                  {/* App icon with glow */}
                  <div className="relative shrink-0">
                    <div 
                      className="absolute inset-0 rounded-xl blur-lg opacity-50"
                      style={{ background: "hsl(173 80% 50%)" }}
                    />
                    <img
                      src="/pwa-192x192.png"
                      alt="CleanCards"
                      className="relative w-14 h-14 rounded-xl shadow-lg"
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pr-6">
                    <h3 
                      className="font-semibold text-base"
                      style={{ color: "hsl(210 40% 98%)" }}
                    >
                      Install CleanCards
                    </h3>
                    <p 
                      className="text-sm mt-0.5"
                      style={{ color: "hsl(215 20% 55%)" }}
                    >
                      Get the full native experience
                    </p>
                  </div>
                </div>

                {/* Install button */}
                <Button
                  onClick={handleInstall}
                  disabled={installing}
                  className="w-full mt-4 h-11 font-medium rounded-xl"
                  style={{
                    background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(173 80% 40%))",
                    color: "hsl(220 20% 4%)"
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {installing ? "Installing..." : platform === "ios" ? "How to Install" : "Install Now"}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Instructions modal */}
      <AnimatePresence>
        {showInstructions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
            style={{ background: "hsl(0 0% 0% / 0.7)" }}
            onClick={() => setShowInstructions(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden"
              style={{
                background: "linear-gradient(180deg, hsl(220 18% 10%), hsl(220 18% 7%))",
                border: "1px solid hsl(220 13% 18%)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 
                    className="text-lg font-semibold"
                    style={{ color: "hsl(210 40% 98%)" }}
                  >
                    Install CleanCards
                  </h3>
                  <button
                    onClick={() => setShowInstructions(false)}
                    className="p-1"
                    style={{ color: "hsl(215 20% 55%)" }}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {platform === "ios" ? (
                  <div className="space-y-4">
                    <p 
                      className="text-sm"
                      style={{ color: "hsl(215 20% 55%)" }}
                    >
                      To install on your iPhone or iPad:
                    </p>
                    <ol className="space-y-4">
                      {[
                        { icon: Share, text: 'Tap the Share button in Safari' },
                        { icon: null, text: 'Scroll and tap "Add to Home Screen"' },
                        { icon: null, text: 'Tap "Add" to confirm' }
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span 
                            className="w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0"
                            style={{ 
                              background: "hsl(173 80% 50%)", 
                              color: "hsl(220 20% 4%)" 
                            }}
                          >
                            {i + 1}
                          </span>
                          <span 
                            className="text-sm pt-1"
                            style={{ color: "hsl(210 40% 98%)" }}
                          >
                            {step.icon && <step.icon className="inline w-4 h-4 mx-1" style={{ color: "hsl(173 80% 50%)" }} />}
                            {step.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p 
                      className="text-sm"
                      style={{ color: "hsl(215 20% 55%)" }}
                    >
                      To install on your Android device:
                    </p>
                    <ol className="space-y-4">
                      {[
                        { icon: MoreVertical, text: 'Tap the menu button in Chrome' },
                        { icon: null, text: 'Tap "Install app" or "Add to Home screen"' },
                        { icon: null, text: 'Confirm the installation' }
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span 
                            className="w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0"
                            style={{ 
                              background: "hsl(173 80% 50%)", 
                              color: "hsl(220 20% 4%)" 
                            }}
                          >
                            {i + 1}
                          </span>
                          <span 
                            className="text-sm pt-1"
                            style={{ color: "hsl(210 40% 98%)" }}
                          >
                            {step.icon && <step.icon className="inline w-4 h-4 mx-1" style={{ color: "hsl(173 80% 50%)" }} />}
                            {step.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full mt-6"
                  onClick={() => setShowInstructions(false)}
                >
                  Got it
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
