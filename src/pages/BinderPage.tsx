import { useState, useMemo } from "react";
import { BookOpen, Camera } from "lucide-react";
import { useBinderData } from "@/hooks/use-binder-data";
import { useBinderSettings } from "@/hooks/use-binder-settings";
import { BinderGrid } from "@/components/binder/BinderGrid";
import { BinderControls } from "@/components/binder/BinderControls";
import { BinderPageCapture } from "@/components/binder/BinderPageCapture";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function BinderPage() {
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [showVariants, setShowVariants] = useState(true);
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [flipStyle, setFlipStyle] = useState<"3d" | "slide">("3d");
  const [captureOpen, setCaptureOpen] = useState(false);

  const { sets, slots, loading, stats } = useBinderData(selectedSetId);
  const { settings: pictureSettings, update: updatePictureSettings } = useBinderSettings();

  const selectedSetName = useMemo(
    () => sets.find((s) => s.id === selectedSetId)?.set_name ?? null,
    [sets, selectedSetId]
  );

  const filteredSlots = useMemo(() => {
    let result = slots;
    if (showMissingOnly) result = result.filter((s) => !s.owned);
    if (!showVariants) {
      const seen = new Set<string>();
      result = result.filter((s) => {
        const key = `${s.cardNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return result;
  }, [slots, showMissingOnly, showVariants]);

  return (
    <div className="container max-w-6xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Binder Mode</h1>
            <p className="text-sm text-muted-foreground">Browse your collection in set order</p>
          </div>
        </div>
        <Button
          onClick={() => setCaptureOpen(true)}
          className="gap-2"
          size="sm"
        >
          <Camera className="h-4 w-4" />
          Capture Page
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar controls */}
        <aside className="space-y-4">
          <BinderControls
            sets={sets}
            selectedSetId={selectedSetId}
            onSetChange={setSelectedSetId}
            showMissingOnly={showMissingOnly}
            onShowMissingOnly={setShowMissingOnly}
            showPrices={showPrices}
            onShowPrices={setShowPrices}
            showVariants={showVariants}
            onShowVariants={setShowVariants}
            heatmapMode={heatmapMode}
            onHeatmapMode={setHeatmapMode}
            flipStyle={flipStyle}
            onFlipStyle={setFlipStyle}
            stats={stats}
            pictureSettings={pictureSettings}
            onPictureSettingsChange={updatePictureSettings}
          />
        </aside>

        {/* Main binder area */}
        <main>
          {!selectedSetId ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <BookOpen className="h-12 w-12 text-muted-foreground/30" />
              <div className="space-y-1">
                <p className="text-muted-foreground">Select a set to view your binder</p>
                <p className="text-xs text-muted-foreground/60">
                  Or capture a binder page right now to identify its 9 cards
                </p>
              </div>
              <Button onClick={() => setCaptureOpen(true)} variant="outline" className="gap-2">
                <Camera className="h-4 w-4" />
                Capture a Binder Page
              </Button>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[2.5/3.5] rounded-lg" />
              ))}
            </div>
          ) : filteredSlots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <p className="text-muted-foreground">No cards found for this set</p>
            </div>
          ) : (
            <BinderGrid
              slots={filteredSlots}
              showPrices={showPrices}
              heatmapMode={heatmapMode}
              flipStyle={flipStyle}
              pictureSettings={pictureSettings}
              selectedSetName={selectedSetName}
              onCaptureClick={() => setCaptureOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Capture dialog (always available) */}
      <BinderPageCapture
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        setName={selectedSetName}
      />
    </div>
  );
}
