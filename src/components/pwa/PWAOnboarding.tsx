import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Sparkles,
  Database,
  TrendingUp,
  Wifi,
  WifiOff,
  ChevronRight,
  ChevronLeft,
  X,
  Smartphone,
  Zap,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PWAOnboardingProps {
  onComplete: () => void;
  onSkip?: () => void;
}

const slides = [
  {
    id: "welcome",
    icon: Sparkles,
    title: "Welcome to CleanCards",
    description: "Your AI-powered trading card collection manager. Scan, catalog, and track your cards with ease.",
    gradient: "from-primary/20 to-primary/5",
    features: [
      { icon: Camera, text: "Instant card scanning" },
      { icon: TrendingUp, text: "Real-time price tracking" },
      { icon: Database, text: "Smart organization" },
    ],
  },
  {
    id: "scan",
    icon: Camera,
    title: "Scan Any Card",
    description: "Use your phone's camera to instantly identify and catalog any trading card. Our AI recognizes thousands of cards.",
    gradient: "from-blue-500/20 to-blue-500/5",
    features: [
      { icon: Zap, text: "Lightning-fast recognition" },
      { icon: Sparkles, text: "AI-powered identification" },
      { icon: Shield, text: "Accurate pricing" },
    ],
  },
  {
    id: "offline",
    icon: WifiOff,
    title: "Works Offline",
    description: "Your collection is always available, even without internet. Data syncs automatically when you're back online.",
    gradient: "from-green-500/20 to-green-500/5",
    features: [
      { icon: Database, text: "Local storage" },
      { icon: Wifi, text: "Auto-sync" },
      { icon: Smartphone, text: "Native app experience" },
    ],
  },
  {
    id: "ready",
    icon: TrendingUp,
    title: "You're All Set!",
    description: "Start building your collection today. Scan your first card or explore the dashboard.",
    gradient: "from-yellow-500/20 to-yellow-500/5",
    features: [],
  },
];

export function PWAOnboarding({ onComplete, onSkip }: PWAOnboardingProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);

  const isLastSlide = currentSlide === slides.length - 1;
  const slide = slides[currentSlide];

  const handleNext = () => {
    if (isLastSlide) {
      onComplete();
    } else {
      setDirection(1);
      setCurrentSlide((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setDirection(-1);
      setCurrentSlide((prev) => prev - 1);
    }
  };

  const handleDotClick = (index: number) => {
    setDirection(index > currentSlide ? 1 : -1);
    setCurrentSlide(index);
  };

  // Handle touch swipe
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && currentSlide < slides.length - 1) {
      handleNext();
    }
    if (isRightSwipe && currentSlide > 0) {
      handlePrev();
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-background flex flex-col overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Skip button */}
      {onSkip && !isLastSlide && (
        <button
          onClick={onSkip}
          className="absolute top-4 right-4 z-10 p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 safe-area-inset">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slide.id}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col items-center text-center max-w-sm mx-auto w-full"
          >
            {/* Icon */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className={cn(
                "w-24 h-24 sm:w-28 sm:h-28 rounded-3xl flex items-center justify-center mb-6 sm:mb-8",
                "bg-gradient-to-br",
                slide.gradient
              )}
            >
              <slide.icon className="w-12 h-12 sm:w-14 sm:h-14 text-primary" />
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="text-2xl sm:text-3xl font-bold text-foreground mb-3 sm:mb-4"
            >
              {slide.title}
            </motion.h2>

            {/* Description */}
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-base sm:text-lg text-muted-foreground mb-6 sm:mb-8 leading-relaxed"
            >
              {slide.description}
            </motion.p>

            {/* Features */}
            {slide.features.length > 0 && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="space-y-3 w-full"
              >
                {slide.features.map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <feature.icon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm sm:text-base text-foreground font-medium">
                      {feature.text}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/* Get Started button for last slide */}
            {isLastSlide && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-8 w-full"
              >
                <Button
                  onClick={onComplete}
                  size="lg"
                  className="w-full h-14 text-lg font-semibold rounded-xl"
                >
                  Get Started
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom navigation */}
      <div className="px-6 pb-8 pt-4 safe-area-bottom">
        {/* Dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => handleDotClick(index)}
              className={cn(
                "transition-all duration-300 rounded-full",
                index === currentSlide
                  ? "w-8 h-2 bg-primary"
                  : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        {!isLastSlide && (
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              onClick={handlePrev}
              disabled={currentSlide === 0}
              className="h-12 px-4"
            >
              <ChevronLeft className="h-5 w-5 mr-1" />
              Back
            </Button>

            <Button onClick={handleNext} className="h-12 px-8 flex-1 max-w-[200px]">
              Next
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
