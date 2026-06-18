import { useEffect, useState } from "react";
import { MonitorSmartphone, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

 type ScanOrientation = "portrait" | "landscape";

const STORAGE_KEY = "rapid-scan-layout-orientation";

function readSaved(): ScanOrientation {
  try {
    return localStorage.getItem(STORAGE_KEY) === "landscape" ? "landscape" : "portrait";
  } catch {
    return "portrait";
  }
}

function physicalOrientation(): ScanOrientation {
  return window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
}

function applyLayout(mode: ScanOrientation) {
  document.documentElement.dataset.rapidScanOrientation = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
}

async function requestOrientationLock(mode: ScanOrientation): Promise<"locked" | "unsupported" | "failed"> {
  const orientation = (screen as any)?.orientation;
  if (!orientation?.lock) return "unsupported";
  try {
    await orientation.lock(mode);
    return "locked";
  } catch {
    return "failed";
  }
}

export function RapidScanOrientationControl() {
  const [mode, setMode] = useState<ScanOrientation>(readSaved);
  const [actual, setActual] = useState<ScanOrientation>(() => physicalOrientation());
  const [lockState, setLockState] = useState<"idle" | "locked" | "unsupported" | "failed">("idle");
  const visible = location.pathname === "/scan";

  useEffect(() => {
    applyLayout(mode);
  }, [mode]);

  useEffect(() => {
    const update = () => {
      const next = physicalOrientation();
      setActual(next);
      if (next !== mode) {
        const reason = !(screen as any)?.orientation?.lock
          ? "Browser orientation lock is unsupported on this iPhone/browser, so the physical phone rotation changed the viewport. The selected scanner layout is still being forced by the app."
          : "The device rotated away from the selected scanner layout. Orientation lock may have been rejected because the app is not fullscreen or installed as a PWA.";
        window.dispatchEvent(new CustomEvent("rapid-scan-job-error", {
          detail: {
            id: "orientation",
            error: `Orientation mismatch: selected ${mode}, device reported ${next}. ${reason}`,
          },
        }));
      }
    };

    const media = window.matchMedia("(orientation: landscape)");
    media.addEventListener?.("change", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener?.("change", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, [mode]);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.rapidScanOrientationStyles = "true";
    style.textContent = `
      html[data-rapid-scan-orientation="portrait"] body:has(a[href="/scan"]) video[playsinline] {
        aspect-ratio: 5 / 7 !important;
        width: min(100%, 430px) !important;
        height: min(68dvh, 720px) !important;
        margin-inline: auto !important;
        object-fit: contain !important;
      }
      html[data-rapid-scan-orientation="portrait"] body:has(a[href="/scan"]) video[playsinline] + * {
        max-width: 430px;
      }
      html[data-rapid-scan-orientation="landscape"] body:has(a[href="/scan"]) video[playsinline] {
        aspect-ratio: 16 / 9 !important;
        width: 100% !important;
        height: min(68dvh, 620px) !important;
        object-fit: contain !important;
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  if (!visible) return null;

  const select = async (next: ScanOrientation) => {
    setMode(next);
    applyLayout(next);
    setLockState("idle");
    const result = await requestOrientationLock(next);
    setLockState(result);
  };

  return (
    <div className="fixed left-1/2 top-3 z-[95] -translate-x-1/2 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur">
      <div className="flex items-center gap-1">
        <Button size="sm" variant={mode === "portrait" ? "default" : "ghost"} className="h-8 px-2.5" onClick={() => void select("portrait")}>
          <RectangleVertical className="mr-1.5 h-4 w-4" />Portrait
        </Button>
        <Button size="sm" variant={mode === "landscape" ? "default" : "ghost"} className="h-8 px-2.5" onClick={() => void select("landscape")}>
          <RectangleHorizontal className="mr-1.5 h-4 w-4" />Landscape
        </Button>
        <Badge variant={actual === mode ? "outline" : "destructive"} className="ml-1 hidden sm:flex">
          <MonitorSmartphone className="mr-1 h-3 w-3" />{actual}
        </Badge>
      </div>
      {lockState === "unsupported" && <div className="px-2 pb-1 pt-1 text-center text-[10px] text-muted-foreground">iPhone browser cannot lock rotation; layout remains forced.</div>}
      {lockState === "failed" && <div className="px-2 pb-1 pt-1 text-center text-[10px] text-muted-foreground">Rotation lock was rejected; use PWA/fullscreen for hardware lock.</div>}
    </div>
  );
}
