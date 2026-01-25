import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  ArrowRight,
  Camera,
  TrendingUp,
  Database,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAStatus } from "@/hooks/use-pwa-status";

export default function InstallPage() {
  const { 
    isInstalled, 
    platform, 
    canInstall, 
    triggerInstall 
  } = usePWAStatus();
  
  const [installing, setInstalling] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);

  const features = [
    { 
      icon: Camera, 
      title: "AI Card Scanning", 
      description: "Instantly identify and catalog any trading card with our advanced AI recognition system",
      gradient: "from-primary to-primary/60"
    },
    { 
      icon: TrendingUp, 
      title: "Real-time Prices", 
      description: "Track market values across multiple sources with live price updates",
      gradient: "from-accent to-accent/60"
    },
    { 
      icon: Wifi, 
      title: "Works Offline", 
      description: "Access your entire collection anywhere, even without internet",
      gradient: "from-success to-success/60"
    },
    { 
      icon: Database, 
      title: "Smart Collection", 
      description: "Organize, filter, and analyze your cards with powerful tools",
      gradient: "from-warning to-warning/60"
    },
  ];

  const benefits = [
    { icon: Zap, text: "Lightning fast" },
    { icon: Shield, text: "Secure & private" },
    { icon: Sparkles, text: "Premium experience" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [features.length]);

  const handleInstallClick = async () => {
    setInstalling(true);
    try {
      await triggerInstall();
    } finally {
      setInstalling(false);
    }
  };

  if (isInstalled) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center p-4 safe-area-inset"
        style={{ background: "hsl(220 20% 4%)" }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="mx-auto mb-6 w-24 h-24 rounded-full flex items-center justify-center"
            style={{ 
              background: "hsl(152 76% 43% / 0.15)",
              boxShadow: "0 0 40px hsl(152 76% 43% / 0.2)"
            }}
          >
            <Check className="w-12 h-12" style={{ color: "hsl(152 76% 43%)" }} />
          </motion.div>
          
          <h1 
            className="text-2xl sm:text-3xl font-bold mb-3"
            style={{ color: "hsl(210 40% 98%)" }}
          >
            Already Installed!
          </h1>
          <p 
            className="mb-6"
            style={{ color: "hsl(215 20% 55%)" }}
          >
            CleanCards is installed on your device. Open it from your home screen for the best experience.
          </p>
          <Button 
            onClick={() => window.location.href = "/"} 
            className="w-full max-w-xs h-12"
            style={{
              background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(173 80% 40%))",
              color: "hsl(220 20% 4%)"
            }}
          >
            Open App
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen flex flex-col safe-area-inset overflow-hidden"
      style={{ background: "linear-gradient(180deg, hsl(220 20% 4%) 0%, hsl(220 25% 6%) 100%)" }}
    >
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.3, 0.2]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[120px]"
          style={{ background: "hsl(173 80% 50%)" }}
        />
        <motion.div
          animate={{ 
            scale: [1.2, 1, 1.2],
            opacity: [0.15, 0.25, 0.15]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full blur-[100px]"
          style={{ background: "hsl(262 83% 58%)" }}
        />
      </div>

      {/* Hero section */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center max-w-lg w-full"
        >
          {/* App icon with premium effects */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="mx-auto mb-8 relative"
          >
            {/* Outer glow */}
            <div 
              className="absolute inset-[-20px] rounded-[40px] blur-xl opacity-50"
              style={{ background: "hsl(173 80% 50%)" }}
            />
            
            {/* Spinning border */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
              className="absolute inset-[-3px] rounded-[32px]"
              style={{
                background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(262 83% 58%), hsl(173 80% 50%))",
                padding: "3px"
              }}
            >
              <div 
                className="w-full h-full rounded-[29px]"
                style={{ background: "hsl(220 20% 4%)" }}
              />
            </motion.div>
            
            <img
              src="/pwa-192x192.png"
              alt="CleanCards"
              className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl shadow-2xl"
            />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-3xl sm:text-4xl font-bold mb-3"
            style={{
              background: "linear-gradient(135deg, hsl(210 40% 98%), hsl(173 80% 60%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text"
            }}
          >
            CleanCards
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-lg mb-2"
            style={{ color: "hsl(215 20% 55%)" }}
          >
            AI-Powered Card Collection Manager
          </motion.p>

          {/* Animated feature showcase */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="my-8 h-32 relative overflow-hidden"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeFeature}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 flex flex-col items-center justify-center"
              >
                <div 
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                  style={{
                    background: `linear-gradient(135deg, hsl(173 80% 50% / 0.2), hsl(262 83% 58% / 0.1))`
                  }}
                >
                  {(() => {
                    const Icon = features[activeFeature].icon;
                    return <Icon className="w-7 h-7" style={{ color: "hsl(173 80% 50%)" }} />;
                  })()}
                </div>
                <h3 
                  className="text-lg font-semibold mb-1"
                  style={{ color: "hsl(210 40% 98%)" }}
                >
                  {features[activeFeature].title}
                </h3>
                <p 
                  className="text-sm max-w-xs"
                  style={{ color: "hsl(215 20% 55%)" }}
                >
                  {features[activeFeature].description}
                </p>
              </motion.div>
            </AnimatePresence>
            
            {/* Feature indicators */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex gap-2">
              {features.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveFeature(i)}
                  className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    background: i === activeFeature 
                      ? "hsl(173 80% 50%)" 
                      : "hsl(220 13% 25%)",
                    transform: i === activeFeature ? "scale(1.3)" : "scale(1)"
                  }}
                />
              ))}
            </div>
          </motion.div>

          {/* Install section */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {canInstall && platform !== "ios" ? (
              <Button 
                onClick={handleInstallClick} 
                className="w-full h-14 text-lg font-semibold rounded-xl btn-premium"
                disabled={installing}
                style={{
                  background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(173 80% 40%))",
                  color: "hsl(220 20% 4%)",
                  boxShadow: "0 10px 40px hsl(173 80% 50% / 0.3)"
                }}
              >
                <Download className="mr-2 h-5 w-5" />
                {installing ? "Installing..." : "Install App"}
              </Button>
            ) : platform === "ios" ? (
              <div 
                className="rounded-2xl p-5 text-left"
                style={{ 
                  background: "hsl(220 18% 10%)",
                  border: "1px solid hsl(220 13% 18%)"
                }}
              >
                <p 
                  className="font-semibold mb-4 flex items-center gap-2"
                  style={{ color: "hsl(210 40% 98%)" }}
                >
                  <Smartphone className="h-5 w-5" style={{ color: "hsl(173 80% 50%)" }} />
                  Install on iOS
                </p>
                <ol className="space-y-4">
                  {[
                    { icon: Share, text: <>Tap <Share className="inline w-4 h-4 mx-1" style={{ color: "hsl(173 80% 50%)" }} /> <strong>Share</strong> in Safari</> },
                    { text: <>Scroll and tap <strong>"Add to Home Screen"</strong></> },
                    { text: <>Tap <strong>"Add"</strong> to confirm</> }
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
                        className="text-sm pt-0.5"
                        style={{ color: "hsl(210 40% 98%)" }}
                      >
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : platform === "android" ? (
              <div 
                className="rounded-2xl p-5 text-left"
                style={{ 
                  background: "hsl(220 18% 10%)",
                  border: "1px solid hsl(220 13% 18%)"
                }}
              >
                <p 
                  className="font-semibold mb-4 flex items-center gap-2"
                  style={{ color: "hsl(210 40% 98%)" }}
                >
                  <Smartphone className="h-5 w-5" style={{ color: "hsl(173 80% 50%)" }} />
                  Install on Android
                </p>
                <ol className="space-y-4">
                  {[
                    { text: <>Tap <MoreVertical className="inline w-4 h-4 mx-1" style={{ color: "hsl(173 80% 50%)" }} /> <strong>Menu</strong> in Chrome</> },
                    { text: <>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></> },
                    { text: <>Confirm the installation</> }
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
                        className="text-sm pt-0.5"
                        style={{ color: "hsl(210 40% 98%)" }}
                      >
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="text-center">
                <Monitor 
                  className="mx-auto h-16 w-16 mb-4" 
                  style={{ color: "hsl(215 20% 35%)" }} 
                />
                <p style={{ color: "hsl(215 20% 55%)" }}>
                  Visit this page on your mobile device to install the app
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* Bottom benefits section */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="px-6 pb-8 pt-4 safe-area-bottom relative z-10"
      >
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-center gap-6">
            {benefits.map((benefit, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + i * 0.05 }}
                className="flex items-center gap-2"
              >
                <benefit.icon className="w-4 h-4" style={{ color: "hsl(173 80% 50%)" }} />
                <span 
                  className="text-sm font-medium"
                  style={{ color: "hsl(215 20% 55%)" }}
                >
                  {benefit.text}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
