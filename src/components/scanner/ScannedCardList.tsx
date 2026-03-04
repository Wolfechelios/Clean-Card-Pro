import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async/withTimeout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit2, DollarSign, Hash, Sparkles, Trash2, Loader2, Library, Plus, List, Copy, Check, User, Gamepad2, Download, ImageIcon, PackageOpen } from "lucide-react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScannedCard {
  id: string;
  preview: string;
  status: "queued" | "uploading" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  playerName?: string;
  rarity?: string;
  gameType?: string;
  sportType?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
  // Scan mode fields
  libraryQuantity?: number;
  isInLibrary?: boolean;
  imageUrl?: string;
  year?: string;
  team?: string;
  manufacturer?: string;
}

interface ScannedCardListProps {
  cards: ScannedCard[];
  onCardUpdate: (id: string, updates: Partial<ScannedCard>) => void;
  onCardDelete?: (id: string) => void;

  scanMode?: boolean;
  removeMode?: boolean;

  onAddToLibrary?: (id: string) => void;
  onAddAllToLibrary?: () => void;

  onRemoveFromLibrary?: (id: string, dbId: string) => void;
  onRemoveAllFromLibrary?: () => void;

  onReorder?: (orderedIds: string[]) => void;
}

const RARITY_OPTIONS = [
  "Common",
  "Uncommon",
  "Rare",
  "Super Rare",
  "Ultra Rare",
  "Secret Rare",
  "Starlight Rare",
  "Ghost Rare",
  "Prismatic Secret Rare",
  "1st Edition",
  "Limited Edition",
  "Holo Rare",
  "Reverse Holo",
];

// Preview sizing
const LIST_THUMB_CLASS = "w-14 h-20 object-cover rounded-md border border-border/50";
const EDIT_PREVIEW_CLASS = "w-40 h-56 object-cover rounded-lg border";

export const ScannedCardList = ({
  cards,
  onCardUpdate,
  onCardDelete,
  scanMode,
  removeMode,
  onAddToLibrary,
  onAddAllToLibrary,
  onRemoveFromLibrary,
  onRemoveAllFromLibrary,
  onReorder,
}: ScannedCardListProps) => {
  const [editingCard, setEditingCard] = useState<ScannedCard | null>(null);
  const [editForm, setEditForm] = useState({
    cardName: "",
    cardSet: "",
    cardNumber: "",
    rarity: "",
    value: "",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [isRemovingAll, setIsRemovingAll] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showListDialog, setShowListDialog] = useState(false);
  const [listCopied, setListCopied] = useState(false);

  const [dragId, setDragId] = useState<string | null>(null);

  const completedCards = useMemo(() => cards.filter((c) => c.status === "completed"), [cards]);

  const totalValue = useMemo(
    () => completedCards.reduce((sum, c) => sum + (c.value || 0), 0),
    [completedCards]
  );

  const newCardsCount = useMemo(
    () => (scanMode ? completedCards.filter((c) => !c.dbId).length : 0),
    [scanMode, completedCards]
  );

  const libraryCardsCount = useMemo(
    () => (removeMode ? completedCards.filter((c) => c.isInLibrary && c.dbId).length : 0),
    [removeMode, completedCards]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === completedCards.length) return new Set();
      return new Set(completedCards.map((c) => c.id));
    });
  }, [completedCards]);

  const selectedCards = useMemo(() => completedCards.filter((c) => selectedIds.has(c.id)), [completedCards, selectedIds]);

  const selectedValue = useMemo(
    () => selectedCards.reduce((sum, c) => sum + (c.value || 0), 0),
    [selectedCards]
  );

  const generateListText = useCallback((includeImages = false) => {
    const cardsToList = selectedCards.length > 0 ? selectedCards : completedCards;

    const lines = cardsToList.map((c, i) => {
      const parts: string[] = [`${i + 1}. ${c.cardName || "Unknown"}`];
      if (c.playerName && c.playerName !== c.cardName) parts.push(`| Player: ${c.playerName}`);
      if (c.cardNumber) parts.push(`| Card #${c.cardNumber}`);
      if (c.cardSet) parts.push(`| Set: ${c.cardSet}`);
      if (c.year) parts.push(`| Year: ${c.year}`);
      if (c.team) parts.push(`| Team: ${c.team}`);
      if (c.manufacturer) parts.push(`| Mfr: ${c.manufacturer}`);
      if (c.gameType) parts.push(`| Type: ${c.gameType}`);
      if (c.sportType) parts.push(`| Sport: ${c.sportType}`);
      if (c.rarity) parts.push(`| Rarity: ${c.rarity}`);
      if (c.value != null && c.value > 0) parts.push(`| $${c.value.toFixed(2)}`);
      if (includeImages && c.imageUrl) parts.push(`\n   Image: ${c.imageUrl}`);
      else if (includeImages && c.preview && c.preview.startsWith("http")) parts.push(`\n   Image: ${c.preview}`);
      return parts.join(" ");
    });

    const total = cardsToList.reduce((sum, c) => sum + (c.value || 0), 0);
    lines.push("");
    lines.push(`Total: ${cardsToList.length} cards — $${total.toFixed(2)}`);
    return lines.join("\n");
  }, [selectedCards, completedCards]);

  const copyList = useCallback(async (includeImages = false) => {
    const text = generateListText(includeImages);
    try {
      await navigator.clipboard.writeText(text);
      setListCopied(true);
      toast.success(includeImages ? "List with image URLs copied!" : "List copied to clipboard");
      setTimeout(() => setListCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, [generateListText]);

  const [downloadingImages, setDownloadingImages] = useState(false);

  const downloadImages = useCallback(async () => {
    const cardsToExport = selectedCards.length > 0 ? selectedCards : completedCards;
    const imageCards = cardsToExport.filter(c => c.imageUrl || (c.preview && c.preview.startsWith("http")));
    
    if (imageCards.length === 0) {
      toast.error("No card images available to download");
      return;
    }

    setDownloadingImages(true);
    const toastId = toast.loading(`Downloading ${imageCards.length} images...`);

    try {
      const zip = new JSZip();
      const imgFolder = zip.folder("card-images")!;

      // Include listing text in the zip
      const listText = generateListText(false);
      zip.file("listing.txt", listText);

      let successCount = 0;
      const batchSize = 4;

      for (let i = 0; i < imageCards.length; i += batchSize) {
        const batch = imageCards.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (c) => {
            const url = c.imageUrl || c.preview;
            if (!url) return;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const ext = blob.type.includes("png") ? "png" : "jpg";
            const safeName = (c.cardName || "card").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
            const num = c.cardNumber ? `_${c.cardNumber.replace(/[^a-zA-Z0-9-]/g, "")}` : "";
            const fileName = `${safeName}${num}_${c.id.slice(0, 6)}.${ext}`;
            imgFolder.file(fileName, blob);
            successCount++;
          })
        );
        toast.loading(`Downloaded ${Math.min(i + batchSize, imageCards.length)}/${imageCards.length}...`, { id: toastId });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `card-images-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${successCount} card images as ZIP`, { id: toastId });
    } catch (err: any) {
      console.error("Image download error:", err);
      toast.error(`Failed to download images: ${err.message}`, { id: toastId });
    } finally {
      setDownloadingImages(false);
    }
  }, [selectedCards, completedCards, generateListText]);

  const handleAddAll = useCallback(async () => {
    if (!onAddAllToLibrary) return;
    setIsAddingAll(true);
    try {
      await onAddAllToLibrary();
    } finally {
      setIsAddingAll(false);
    }
  }, [onAddAllToLibrary]);

  const handleRemoveAll = useCallback(async () => {
    if (!onRemoveAllFromLibrary) return;
    setIsRemovingAll(true);
    try {
      await onRemoveAllFromLibrary();
    } finally {
      setIsRemovingAll(false);
    }
  }, [onRemoveAllFromLibrary]);

  const handleRemoveFromLibrary = useCallback(
    async (card: ScannedCard) => {
      if (!onRemoveFromLibrary || !card.dbId) return;
      setRemovingId(card.id);
      try {
        await onRemoveFromLibrary(card.id, card.dbId);
      } finally {
        setRemovingId(null);
      }
    },
    [onRemoveFromLibrary]
  );

  const openEditDialog = useCallback((card: ScannedCard) => {
    setEditingCard(card);
    setEditForm({
      cardName: card.cardName || "",
      cardSet: card.cardSet || "",
      cardNumber: card.cardNumber || "",
      rarity: card.rarity || "",
      value: card.value?.toString() || "",
    });
  }, []);

  const handleDelete = useCallback(
    async (card: ScannedCard) => {
      if (!onCardDelete) return;

      setDeletingId(card.id);
      try {
      if (card.dbId) {
          const res = await supabase.from("cards").delete().eq("id", card.dbId);
          if (res.error) throw res.error;
        }

        onCardDelete(card.id);
        toast.success("Card deleted");
      } catch (error) {
        console.error("Failed to delete card:", error);
        toast.error("Failed to delete card");
      } finally {
        setDeletingId(null);
      }
    },
    [onCardDelete]
  );

  const handleSave = useCallback(async () => {
    if (!editingCard) return;

    setIsSaving(true);
    try {
      onCardUpdate(editingCard.id, {
        cardName: editForm.cardName,
        cardSet: editForm.cardSet,
        cardNumber: editForm.cardNumber,
        rarity: editForm.rarity,
        value: editForm.value ? parseFloat(editForm.value) : null,
      });

      if (editingCard.dbId) {
        const res = await supabase
          .from("cards")
          .update({
            card_name: editForm.cardName,
            card_set: editForm.cardSet,
            card_number: editForm.cardNumber,
            rarity: editForm.rarity,
            suggested_price: editForm.value ? parseFloat(editForm.value) : null,
          })
          .eq("id", editingCard.dbId);
        if (res.error) throw res.error;
      }

      toast.success("Card updated successfully");
      setEditingCard(null);
    } catch (error) {
      console.error("Failed to update card:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [editingCard, editForm, onCardUpdate]);

  // --- Manual virtualization (NO extra deps) ---
  const VROW_H = 92;
  const V_OVERSCAN = 8;

  const parentRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  const useVirtual = completedCards.length > 40;

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 0);
    });

    ro.observe(el);
    setViewportH(el.clientHeight || 0);

    return () => ro.disconnect();
  }, [useVirtual]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  const vTotal = completedCards.length * VROW_H;

  const vStartIndex = useMemo(() => {
    const raw = Math.floor(scrollTop / VROW_H) - V_OVERSCAN;
    return Math.max(0, raw);
  }, [scrollTop]);

  const vEndIndex = useMemo(() => {
    const raw = Math.ceil((scrollTop + viewportH) / VROW_H) + V_OVERSCAN;
    return Math.min(completedCards.length, raw);
  }, [scrollTop, viewportH, completedCards.length]);

  const vItems = useMemo(() => completedCards.slice(vStartIndex, vEndIndex), [completedCards, vStartIndex, vEndIndex]);
  const vOffsetY = vStartIndex * VROW_H;

  if (completedCards.length === 0) return null;

  const renderCardRow = (card: ScannedCard) => (
    <div
      key={card.id}
      draggable={Boolean(onReorder)}
      onDragStart={() => setDragId(card.id)}
      onDragOver={(e) => {
        if (!onReorder) return;
        e.preventDefault();
      }}
      onDrop={() => {
        if (!onReorder || !dragId || dragId === card.id) return;
        const ids = completedCards.map((c) => c.id);
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(card.id);
        if (from < 0 || to < 0) return;
        const next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, dragId);
        onReorder(next);
        setDragId(null);
      }}
      className={`flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${
        scanMode && !card.dbId ? "border-amber-400 dark:border-amber-600" : ""
      }`}
    >
      <Checkbox
        checked={selectedIds.has(card.id)}
        onCheckedChange={() => toggleSelect(card.id)}
        aria-label={`Select ${card.cardName || "card"}`}
        className="shrink-0 mt-1"
      />

      <div className="relative shrink-0">
        <img src={card.preview} alt={card.cardName || "Scanned card"} className={LIST_THUMB_CLASS} />

        {card.libraryQuantity !== undefined && card.libraryQuantity > 0 && (
          <div className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-sm">
            ×{card.libraryQuantity}
          </div>
        )}

        {scanMode && !card.dbId && card.libraryQuantity === 0 && (
          <div className="absolute -top-1 -left-1 bg-accent text-accent-foreground text-[8px] font-bold rounded px-1 shadow-sm">
            NEW
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate text-foreground">{card.cardName || "Unknown Card"}</p>

            {card.playerName && card.playerName !== card.cardName && (
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                <User className="h-3 w-3 shrink-0" />
                {card.playerName}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            {card.priceFetching ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : card.value != null && card.value > 0 ? (
              <p className={`font-bold text-base ${card.value >= 20 ? "text-primary" : "text-success"}`}>
                ${card.value.toFixed(2)}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">—</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {card.cardNumber && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-mono">
              <Hash className="h-2.5 w-2.5 mr-0.5" />
              {card.cardNumber}
            </Badge>
          )}

          {card.rarity && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
              {card.rarity}
            </Badge>
          )}

          {card.gameType && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground">
              <Gamepad2 className="h-2.5 w-2.5 mr-0.5" />
              {card.gameType}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 mt-1.5">
          {removeMode && card.isInLibrary && card.dbId && onRemoveFromLibrary && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleRemoveFromLibrary(card)}
              disabled={removingId === card.id || card.priceFetching}
              className="text-xs h-6 px-2 gap-1"
            >
              {removingId === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Remove
            </Button>
          )}

          {removeMode && !card.isInLibrary && (
            <Badge variant="secondary" className="text-[10px] h-5">
              Not in Library
            </Badge>
          )}

          {scanMode && !removeMode && !card.dbId && onAddToLibrary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAddingId(card.id);
                onAddToLibrary(card.id);
                setTimeout(() => setAddingId(null), 2000);
              }}
              disabled={addingId === card.id || card.priceFetching}
              className="text-xs h-6 px-2 gap-1 border-accent text-accent-foreground"
            >
              {addingId === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          )}

          {scanMode && !removeMode && card.dbId && (
            <Badge variant="secondary" className="text-[10px] h-5 bg-success/15 text-success border-success/30">
              <Library className="h-2.5 w-2.5 mr-0.5" />
              Saved
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(card)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>

            {onCardDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleDelete(card)}
                disabled={deletingId === card.id}
              >
                {deletingId === card.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Library className="h-5 w-5" />
              Scanned Cards
            </CardTitle>
            <div className="text-xs text-muted-foreground">
              {completedCards.length} completed
              {scanMode ? ` • ${newCardsCount} new` : ""}
              {removeMode ? ` • ${libraryCardsCount} in library` : ""}
              {" • "}Total ${totalValue.toFixed(2)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleSelectAll} className="gap-1">
              <Checkbox checked={selectedIds.size === completedCards.length && completedCards.length > 0} />
              {selectedIds.size === completedCards.length ? "Unselect All" : "Select All"}
            </Button>

            <Button variant="outline" size="sm" onClick={() => setShowListDialog(true)} className="gap-1">
              <List className="h-4 w-4" />
              List
            </Button>

            {scanMode && !removeMode && onAddAllToLibrary && (
              <Button size="sm" onClick={handleAddAll} disabled={isAddingAll} className="gap-1">
                {isAddingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add All
              </Button>
            )}

            {removeMode && onRemoveAllFromLibrary && (
              <Button variant="destructive" size="sm" onClick={handleRemoveAll} disabled={isRemovingAll} className="gap-1">
                {isRemovingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove All
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {useVirtual ? (
            <div
              ref={parentRef}
              onScroll={onScroll}
              className="max-h-[60vh] overflow-auto rounded-lg border bg-background"
            >
              <div style={{ height: vTotal, position: "relative" }}>
                <div style={{ position: "absolute", top: vOffsetY, left: 0, right: 0 }} className="space-y-3 p-3">
                  {vItems.map((c) => renderCardRow(c))}
                </div>
              </div>
            </div>
          ) : (
            completedCards.map((c) => renderCardRow(c))
          )}
        </CardContent>
      </Card>

      {/* Create List Dialog */}
      <Dialog open={showListDialog} onOpenChange={setShowListDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Card Listing ({selectedIds.size > 0 ? `${selectedIds.size} selected` : `${completedCards.length} total`})
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{selectedIds.size > 0 ? selectedIds.size : completedCards.length} cards</span>
              <span className="font-semibold text-foreground">
                Total: ${(selectedIds.size > 0 ? selectedValue : totalValue).toFixed(2)}
              </span>
            </div>

            <div className="bg-muted rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs whitespace-pre-wrap font-mono">{generateListText(false)}</pre>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" onClick={downloadImages} disabled={downloadingImages} className="gap-1">
              {downloadingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
              {downloadingImages ? "Zipping..." : "Download Images (ZIP)"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => copyList(true)} className="gap-1">
              <ImageIcon className="h-4 w-4" />
              Copy with Image URLs
            </Button>
            <Button onClick={() => copyList(false)} className="gap-1">
              {listCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {listCopied ? "Copied!" : "Copy List"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Card Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {editingCard && (
              <div className="flex justify-center mb-4">
                <img src={editingCard.preview} alt="Card preview" className={EDIT_PREVIEW_CLASS} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cardName">Card Name</Label>
              <Input
                id="cardName"
                value={editForm.cardName}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cardName: e.target.value }))}
                placeholder="Enter card name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cardSet">Set</Label>
              <Input
                id="cardSet"
                value={editForm.cardSet}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cardSet: e.target.value }))}
                placeholder="Enter card set"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cardNumber">Card Number</Label>
                <Input
                  id="cardNumber"
                  value={editForm.cardNumber}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, cardNumber: e.target.value }))}
                  placeholder="e.g. MRL-051"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="value">Value ($)</Label>
                <Input
                  id="value"
                  type="number"
                  step="0.01"
                  value={editForm.value}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, value: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rarity">Rarity</Label>
              <Select
                value={editForm.rarity}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, rarity: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select rarity" />
                </SelectTrigger>
                <SelectContent>
                  {RARITY_OPTIONS.map((rarity) => (
                    <SelectItem key={rarity} value={rarity}>
                      {rarity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
