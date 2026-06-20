import { useState, useEffect } from "react";

interface SplashScreenProps {
  onComplete: () => void;
  minDisplayTime?: number;
}

export function SplashScreen({
  onComplete,
  minDisplayTime = 2500,
}: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(onComplete, 500);
    }, minDisplayTime);

    return () => clearTimeout(timer);
  }, [minDisplayTime, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-black to-zinc-800 transition-opacity duration-500 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-orange-500/15 rounded-full blur-[80px] animate-pulse delay-300" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-400 via-orange-500 to-red-500 blur-xl opacity-60 animate-spin-slow" />
          <img
            src="/brand/splash-logo.jpg"
            alt="CleanCards"
            className="relative w-40 h-40 rounded-full object-cover border-4 border-amber-400/50 shadow-2xl shadow-amber-500/30 animate-splash-logo"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 rounded-full border-4 border-amber-400/40 animate-ping-slow" />
        </div>

        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent animate-fade-in">
            CleanCards
          </h1>
          <p className="mt-2 text-zinc-400 text-sm tracking-widest uppercase animate-fade-in-delayed">
            Card Collection Manager
          </p>
        </div>

        <div className="flex gap-1.5 animate-fade-in-delayed">
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
