import { cn } from "@/lib/utils";

interface MicroscopeSharpnessIndicatorProps {
  sharpness: number;
}

export function MicroscopeSharpnessIndicator({ sharpness }: MicroscopeSharpnessIndicatorProps) {
  const level = sharpness >= 60 ? "sharp" : sharpness >= 30 ? "ok" : "blurry";
  const color = level === "sharp" ? "bg-green-500" : level === "ok" ? "bg-yellow-500" : "bg-red-500";
  const label = level === "sharp" ? "Sharp" : level === "ok" ? "Fair" : "Blurry";

  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-2 bg-black/70 rounded-md px-2 py-1">
      <div className="flex gap-0.5">
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={cn(
              "w-1.5 rounded-full transition-all",
              sharpness >= (i + 1) * 20 ? color : "bg-white/20"
            )}
            style={{ height: 8 + i * 3 }}
          />
        ))}
      </div>
      <span className="text-[10px] text-white font-medium">{label}</span>
      <span className="text-[10px] text-white/60">{Math.round(sharpness)}%</span>
    </div>
  );
}
