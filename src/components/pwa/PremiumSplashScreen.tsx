import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import splashLogo from "@/assets/splash-logo.jpg";

interface PremiumSplashScreenProps {
  onComplete: () => void;
  minDisplayTime?: number;
}

export function PremiumSplashScreen({ 
  onComplete, 
  minDisplayTime = 2800 
}: PremiumSplashScreenProps) {
  const [phase, setPhase] = useState<"intro" | "logo" | "text" | "exit">("intro");

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    
    // Phase 1: Show logo
    timers.push(setTimeout(() => setPhase("logo"), 200));
    
    // Phase 2: Show text
    timers.push(setTimeout(() => setPhase("text"), 800));
    
    // Phase 3: Exit animation
    timers.push(setTimeout(() => setPhase("exit"), minDisplayTime - 500));
    
    // Phase 4: Complete
    timers.push(setTimeout(onComplete, minDisplayTime));

    return () => timers.forEach(clearTimeout);
  }, [minDisplayTime, onComplete]);

  return (
    <AnimatePresence>
      {phase !== "exit" && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(220 20% 4%) 0%, hsl(220 25% 8%) 50%, hsl(220 20% 4%) 100%)"
          }}
        >
          {/* Animated background particles */}
          <div className="absolute inset-0 overflow-hidden">
            {/* Primary glow orb */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ 
                scale: [0, 1.2, 1],
                opacity: [0, 0.4, 0.25]
              }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[100px]"
              style={{ background: "hsl(173 80% 50% / 0.3)" }}
            />
            
            {/* Secondary accent orb */}
            <motion.div
              initial={{ scale: 0, opacity: 0, x: 100, y: -100 }}
              animate={{ 
                scale: [0, 1],
                opacity: [0, 0.2],
                x: [100, 0],
                y: [-100, 0]
              }}
              transition={{ duration: 2, ease: "easeOut", delay: 0.3 }}
              className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full blur-[80px]"
              style={{ background: "hsl(262 83% 58% / 0.25)" }}
            />
            
            {/* Floating particles */}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ 
                  opacity: 0,
                  y: 100,
                  x: Math.random() * 100 - 50
                }}
                animate={{ 
                  opacity: [0, 0.6, 0],
                  y: [100, -100],
                  x: Math.random() * 100 - 50
                }}
                transition={{
                  duration: 3 + Math.random() * 2,
                  delay: i * 0.2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="absolute w-1 h-1 rounded-full"
                style={{
                  left: `${20 + i * 12}%`,
                  top: "60%",
                  background: i % 2 === 0 
                    ? "hsl(173 80% 60%)" 
                    : "hsl(262 83% 70%)"
                }}
              />
            ))}
          </div>

          {/* Main content */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Logo with premium animation */}
            <motion.div
              initial={{ scale: 0, rotate: -20, opacity: 0 }}
              animate={{ 
                scale: phase !== "intro" ? 1 : 0,
                rotate: phase !== "intro" ? 0 : -20,
                opacity: phase !== "intro" ? 1 : 0
              }}
              transition={{ 
                type: "spring",
                stiffness: 200,
                damping: 15,
                duration: 0.8
              }}
              className="relative mb-8"
            >
              {/* Outer glow ring */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ 
                  scale: [0.8, 1.3, 1],
                  opacity: [0, 0.5, 0.3]
                }}
                transition={{ duration: 1.2, delay: 0.2 }}
                className="absolute inset-[-20px] rounded-full"
                style={{
                  background: "linear-gradient(135deg, hsl(173 80% 50% / 0.3), hsl(262 83% 58% / 0.2))",
                  filter: "blur(20px)"
                }}
              />
              
              {/* Spinning ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute inset-[-4px] rounded-full"
                style={{
                  background: "linear-gradient(135deg, hsl(173 80% 50%), hsl(262 83% 58%), hsl(173 80% 50%))",
                  padding: "3px"
                }}
              >
                <div className="w-full h-full rounded-full bg-background" />
              </motion.div>
              
              {/* Logo image */}
              <img
                src={splashLogo}
                alt="CleanCards"
                className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover shadow-2xl"
                style={{
                  boxShadow: "0 20px 60px hsl(173 80% 50% / 0.3), 0 0 40px hsl(262 83% 58% / 0.2)"
                }}
              />
              
              {/* Pulse effect */}
              <motion.div
                animate={{ 
                  scale: [1, 1.5, 1.5],
                  opacity: [0.4, 0, 0]
                }}
                transition={{ 
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut"
                }}
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: "hsl(173 80% 50% / 0.5)" }}
              />
            </motion.div>

            {/* App name with staggered reveal */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ 
                opacity: phase === "text" || phase === "logo" ? 1 : 0,
                y: phase === "text" || phase === "logo" ? 0 : 20
              }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-center"
            >
              <motion.h1 
                className="text-4xl sm:text-5xl font-black tracking-tight"
                style={{
                  background: "linear-gradient(135deg, hsl(173 80% 60%), hsl(210 40% 98%), hsl(262 83% 70%))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text"
                }}
              >
                CleanCards
              </motion.h1>
              
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: phase === "text" ? 1 : 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="mt-3 text-sm sm:text-base tracking-[0.25em] uppercase"
                style={{ color: "hsl(215 20% 55%)" }}
              >
                AI Card Collection
              </motion.p>
            </motion.div>

            {/* Premium loading indicator */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ 
                opacity: phase === "text" ? 1 : 0,
                scale: phase === "text" ? 1 : 0.8
              }}
              transition={{ duration: 0.4, delay: 0.5 }}
              className="mt-10 flex items-center gap-2"
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: i * 0.15,
                    ease: "easeInOut"
                  }}
                  className="w-2 h-2 rounded-full"
                  style={{ background: "hsl(173 80% 50%)" }}
                />
              ))}
            </motion.div>
          </div>

          {/* Bottom branding */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ 
              opacity: phase === "text" ? 0.5 : 0,
              y: phase === "text" ? 0 : 20
            }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="absolute bottom-8 text-xs tracking-widest uppercase"
            style={{ color: "hsl(215 20% 40%)" }}
          >
            Premium Experience
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
