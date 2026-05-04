import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  AlertTriangle, 
  CheckCircle, 
  Loader2, 
  RefreshCw, 
  Eye,
  Sparkles,
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Search
} from "lucide-react";
import { useCardsNeedingReview, type ReviewReason, type CardNeedingReview } from "@/hooks/use-cards-needing-review";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const REASON_LABELS: Record<ReviewReason, string> = {
  low_ocr_confidence: "Low Confidence",
  missing_rarity: "Missing Rarity",
  missing_name: "Missing Name",
  missing_set: "Missing Set",
  missing_image: "Missing Image",
};

const REASON_COLORS: Record<ReviewReason, string> = {
  low_ocr_confidence: "bg-warning/20 text-warning-foreground",
  missing_rarity: "bg-accent/20 text-accent-foreground",
  missing_name: "bg-destructive/20 text-destructive",
  missing_set: "bg-primary/20 text-primary",
  missing_image: "bg-muted text-muted-foreground",
};

export function CardsNeedingReview() {
  const { cards, counts, loading, fetchCards, fetchCounts, markAsReviewed, dismissCard, deleteCard, deleteAllByFilter, bulkApproveCards } = useCardsNeedingReview();
  const [activeTab, setActiveTab] = useState<ReviewReason | "all">("all");
  const [selectedCard, setSelectedCard] = useState<CardNeedingReview | null>(null);
  const [editValues, setEditValues] = useState({ card_name: "", card_set: "", rarity: "" });
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchMatches, setSearchMatches] = useState<any[]>([]);
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkSearchProgress, setBulkSearchProgress] = useState({ done: 0, total: 0, updated: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);

  // Clear selection when tab changes or list refreshes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === cards.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(cards.map((c) => c.id)));
    }
  };

  const handleApproveSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setApproving(true);
    const result = await bulkApproveCards(ids);
    if (result.success) {
      toast.success(`Approved ${result.approved} card(s)`);
      setSelectedIds(new Set());
      if (selectedCard && ids.includes(selectedCard.id)) setSelectedCard(null);
    } else {
      toast.error("Failed to approve cards");
    }
    setApproving(false);
  };

  const handleApproveAll = async () => {
    const ids = cards.map((c) => c.id);
    if (ids.length === 0) return;
    setApproving(true);
    const result = await bulkApproveCards(ids);
    if (result.success) {
      toast.success(`Approved all ${result.approved} card(s)`);
      setSelectedIds(new Set());
      setSelectedCard(null);
    } else {
      toast.error("Failed to approve cards");
    }
    setApproving(false);
  };

  useEffect(() => {
    if (activeTab === "all") {
      fetchCards();
    } else {
      fetchCards(activeTab);
    }
  }, [activeTab, fetchCards]);

  useEffect(() => {
    if (selectedCard) {
      setEditValues({
        card_name: selectedCard.card_name || "",
        card_set: selectedCard.card_set || "",
        rarity: selectedCard.rarity || "",
      });
      setSearchMatches([]);
    }
  }, [selectedCard]);

  const handleSave = async () => {
    if (!selectedCard) return;
    setSaving(true);

    const updates: Record<string, string | number> = {};
    if (editValues.card_name !== selectedCard.card_name) updates.card_name = editValues.card_name;
    if (editValues.card_set !== selectedCard.card_set) updates.card_set = editValues.card_set;
    if (editValues.rarity !== selectedCard.rarity) updates.rarity = editValues.rarity;
    
    // Mark as verified
    updates.ocr_confidence = 100;

    const success = await markAsReviewed(selectedCard.id, updates);
    
    if (success) {
      toast.success("Card updated");
      // Move to next card
      const currentIndex = cards.findIndex((c) => c.id === selectedCard.id);
      if (currentIndex < cards.length - 1) {
        setSelectedCard(cards[currentIndex + 1]);
      } else {
        setSelectedCard(null);
      }
    } else {
      toast.error("Failed to update card");
    }

    setSaving(false);
  };

  const handleDismiss = async () => {
    if (!selectedCard) return;
    setSaving(true);

    const success = await dismissCard(selectedCard.id);
    
    if (success) {
      toast.success("Card marked as verified");
      const currentIndex = cards.findIndex((c) => c.id === selectedCard.id);
      if (currentIndex < cards.length - 1) {
        setSelectedCard(cards[currentIndex + 1]);
      } else {
        setSelectedCard(null);
      }
    }

    setSaving(false);
  };

  const handleReanalyze = async () => {
    if (!selectedCard) return;
    setReanalyzing(true);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-card-full", {
        body: { image_url: selectedCard.image_url },
      });

      if (error) throw error;

      const details = data?.card_details;
      if (details) {
        setEditValues({
          card_name: details.card_name || editValues.card_name,
          card_set: details.set || editValues.card_set,
          rarity: details.rarity || editValues.rarity,
        });

        // Also persist additional fields directly if available
        const dbUpdates: Record<string, any> = {};
        if (details.card_number) dbUpdates.card_number = details.card_number;
        if (details.game_type) dbUpdates.game_type = details.game_type;
        if (data?.condition_estimate?.raw_grade_estimate) {
          const g = data.condition_estimate.raw_grade_estimate;
          dbUpdates.condition = `PSA ${g.min}-${g.max}`;
        }
        if (data?.vision?.ocr_text) {
          dbUpdates.ocr_raw_text = data.vision.ocr_text;
          dbUpdates.ocr_confidence = Math.round((data.condition_estimate?.raw_grade_estimate?.confidence ?? 0.8) * 100);
        }

        if (Object.keys(dbUpdates).length > 0) {
          await supabase.from("cards").update(dbUpdates as any).eq("id", selectedCard.id);
        }

        toast.success("Re-analysis complete — review the updated fields");
      } else {
        toast.warning("AI returned no card details — try a clearer image");
      }
    } catch (err) {
      console.error("Re-analyze error:", err);
      toast.error("Failed to re-analyze card");
    } finally {
      setReanalyzing(false);
    }
  };

  const handleSearchSetNumber = async () => {
    if (!selectedCard || !editValues.card_name) return;
    setSearching(true);
    setSearchMatches([]);

    try {
      const { data, error } = await supabase.functions.invoke("search-card-details", {
        body: { card_name: editValues.card_name, game_type: "yugioh" },
      });

      if (error) throw error;

      if (data?.matches?.length > 0) {
        setSearchMatches(data.matches);
        // Auto-fill first match
        const best = data.matches[0];
        setEditValues((v) => ({
          ...v,
          card_set: best.card_set || v.card_set,
          rarity: best.rarity || v.rarity,
        }));
        toast.success(`Found ${data.matches.length} match(es) on TCGPlayer`);
      } else {
        toast.info("No matches found on TCGPlayer");
      }
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Failed to search TCGPlayer");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectMatch = (match: any) => {
    setEditValues({
      card_name: match.card_name || editValues.card_name,
      card_set: match.card_set || "",
      rarity: match.rarity || "",
    });
    toast.success(`Selected: ${match.card_name}`);
  };

  const handleBulkSearchSet = async () => {
    if (cards.length === 0) return;
    setBulkSearching(true);
    setBulkSearchProgress({ done: 0, total: cards.length, updated: 0 });
    let updated = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card.card_name || card.card_name === "Unknown Card") {
        setBulkSearchProgress((p) => ({ ...p, done: i + 1 }));
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke("search-card-details", {
          body: { card_name: card.card_name, game_type: "yugioh" },
        });

        if (!error && data?.matches?.length > 0) {
          const best = data.matches[0];
          const updates: Record<string, any> = {};
          if (best.card_set && (!card.card_set || card.card_set === "")) updates.card_set = best.card_set;
          if (best.card_number) updates.card_number = best.card_number;
          if (best.rarity && (!card.rarity || card.rarity === "")) updates.rarity = best.rarity;

          if (Object.keys(updates).length > 0) {
            await supabase.from("cards").update(updates as any).eq("id", card.id);
            updated++;
          }
        }
      } catch (err) {
        console.error("Bulk search error for card:", card.id, err);
      }

      setBulkSearchProgress({ done: i + 1, total: cards.length, updated });
      // Device-aware delay to avoid rate limiting
      const { bulkApiDelayMs } = await import("@/lib/performance/deviceTier").then(m => m.getDeviceTier());
      await new Promise((r) => setTimeout(r, bulkApiDelayMs));
    }

    setBulkSearching(false);
    toast.success(`Bulk search complete: ${updated} cards updated out of ${cards.length}`);
    // Refresh the list
    if (activeTab === "all") {
      fetchCards();
    } else {
      fetchCards(activeTab);
    }
  };

  const navigateCard = (direction: "prev" | "next") => {
    if (!selectedCard) return;
    const currentIndex = cards.findIndex((c) => c.id === selectedCard.id);
    if (direction === "prev" && currentIndex > 0) {
      setSelectedCard(cards[currentIndex - 1]);
    } else if (direction === "next" && currentIndex < cards.length - 1) {
      setSelectedCard(cards[currentIndex + 1]);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    const filter = activeTab === "all" ? undefined : activeTab;
    const result = await deleteAllByFilter(filter);
    
    if (result.success) {
      toast.success(`Deleted ${result.deleted} card(s)`);
      setSelectedCard(null);
    } else {
      toast.error("Failed to delete cards");
    }
    
    setDeleting(false);
    setShowDeleteDialog(false);
  };

  const getDeleteCount = () => {
    if (activeTab === "all") return counts.total;
    return counts[activeTab] || 0;
  };

  const getDeleteLabel = () => {
    if (activeTab === "all") return "all cards with issues";
    return `all ${REASON_LABELS[activeTab].toLowerCase()} cards`;
  };

  const currentIndex = selectedCard ? cards.findIndex((c) => c.id === selectedCard.id) : -1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Cards Needing Review
            </CardTitle>
            <CardDescription>
              {counts.total} cards with issues that need your attention
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={fetchCounts}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkSearchSet}
              disabled={bulkSearching || cards.length === 0}
            >
              {bulkSearching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              {bulkSearching
                ? `Searching ${bulkSearchProgress.done}/${bulkSearchProgress.total}...`
                : `Bulk Search Set (${cards.length})`}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleApproveSelected}
              disabled={approving || selectedIds.size === 0}
            >
              {approving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Approve Selected ({selectedIds.size})
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleApproveAll}
              disabled={approving || cards.length === 0}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Yes to All ({cards.length})
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={() => setShowDeleteDialog(true)}
              disabled={getDeleteCount() === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete All ({getDeleteCount()})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReviewReason | "all")}>
          <TabsList className="grid w-full grid-cols-5 mb-4">
            <TabsTrigger value="all" className="text-xs">
              All ({counts.total})
            </TabsTrigger>
            <TabsTrigger value="missing_name" className="text-xs">
              Name ({counts.missing_name})
            </TabsTrigger>
            <TabsTrigger value="missing_rarity" className="text-xs">
              Rarity ({counts.missing_rarity})
            </TabsTrigger>
            <TabsTrigger value="missing_set" className="text-xs">
              Set ({counts.missing_set})
            </TabsTrigger>
            <TabsTrigger value="low_ocr_confidence" className="text-xs">
              Low Conf ({counts.low_ocr_confidence})
            </TabsTrigger>
          </TabsList>

          {bulkSearching && (
            <div className="mb-4 p-3 border rounded-lg bg-muted/30 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Bulk searching sets...</span>
                <span>{bulkSearchProgress.done}/{bulkSearchProgress.total} • {bulkSearchProgress.updated} updated</span>
              </div>
              <Progress value={bulkSearchProgress.total > 0 ? (bulkSearchProgress.done / bulkSearchProgress.total) * 100 : 0} className="h-2" />
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* Card List */}
            <div className="border rounded-lg">
              <div className="p-2 border-b bg-muted/50 flex items-center gap-2">
                {cards.length > 0 && (
                  <Checkbox
                    checked={selectedIds.size === cards.length && cards.length > 0}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                )}
                <p className="text-sm font-medium">
                  {loading ? "Loading..." : `${cards.length} cards${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}`}
                </p>
              </div>
              <ScrollArea className="h-[400px]">
                {loading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                    <CheckCircle className="h-8 w-8 mb-2 text-success" />
                    <p>All cards reviewed!</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        className={`w-full p-3 hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                          selectedCard?.id === card.id ? "bg-muted" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          onClick={() => setSelectedCard(card)}
                        >
                          {card.image_url && (
                            <img
                              src={card.image_url}
                              alt=""
                              className="h-12 w-9 object-cover rounded shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {card.card_name || "Unknown Card"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {card.card_set || "Unknown Set"}
                            </p>
                            <Badge className={`text-[10px] mt-1 ${REASON_COLORS[card.reason]}`}>
                              {REASON_LABELS[card.reason]}
                            </Badge>
                          </div>
                          {card.ocr_confidence !== null && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {Math.round(card.ocr_confidence)}%
                            </span>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const ok = await deleteCard(card.id);
                            if (ok) {
                              toast.success("Card deleted");
                              if (selectedCard?.id === card.id) setSelectedCard(null);
                            } else {
                              toast.error("Failed to delete card");
                            }
                          }}
                          title="Delete card"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Edit Panel */}
            <div className="border rounded-lg">
              {selectedCard ? (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigateCard("prev")}
                        disabled={currentIndex <= 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {currentIndex + 1} of {cards.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigateCard("next")}
                        disabled={currentIndex >= cards.length - 1}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedCard(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {selectedCard.image_url && (
                    <div className="flex justify-center">
                      <img
                        src={selectedCard.image_url}
                        alt=""
                        className="max-h-48 rounded-lg shadow-md"
                      />
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="card_name">Card Name</Label>
                      <Input
                        id="card_name"
                        value={editValues.card_name}
                        onChange={(e) => setEditValues((v) => ({ ...v, card_name: e.target.value }))}
                        placeholder="Enter card name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="card_set">Set</Label>
                      <Input
                        id="card_set"
                        value={editValues.card_set}
                        onChange={(e) => setEditValues((v) => ({ ...v, card_set: e.target.value }))}
                        placeholder="Enter set name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="rarity">Rarity</Label>
                      <Input
                        id="rarity"
                        value={editValues.rarity}
                        onChange={(e) => setEditValues((v) => ({ ...v, rarity: e.target.value }))}
                        placeholder="Enter rarity"
                      />
                    </div>

                    {/* TCGPlayer Search */}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={handleSearchSetNumber}
                      disabled={searching || !editValues.card_name}
                    >
                      {searching ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Search TCGPlayer for Set / Number
                    </Button>

                    {searchMatches.length > 0 && (
                      <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                        {searchMatches.map((m: any, i: number) => (
                          <button
                            key={i}
                            className="w-full p-2 text-left hover:bg-muted/50 transition-colors text-xs"
                            onClick={() => handleSelectMatch(m)}
                          >
                            <div className="font-medium truncate">{m.card_name}</div>
                            <div className="text-muted-foreground flex gap-2">
                              {m.card_set && <span>{m.card_set}</span>}
                              {m.card_number && <span>#{m.card_number}</span>}
                              {m.rarity && <Badge variant="outline" className="text-[10px] h-4">{m.rarity}</Badge>}
                              {m.market_price && <span className="text-primary">${m.market_price}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      Save & Next
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={handleReanalyze} disabled={reanalyzing}>
                        {reanalyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                        Re-analyze
                      </Button>
                      <Button variant="ghost" onClick={handleDismiss} disabled={saving}>
                        <Eye className="h-4 w-4 mr-2" />
                        Mark OK
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                  <Eye className="h-12 w-12 mb-4 opacity-50" />
                  <p className="text-center">Select a card to review and edit</p>
                </div>
              )}
            </div>
          </div>
        </Tabs>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {getDeleteCount()} cards?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {getDeleteLabel()} from your collection. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {getDeleteCount()} cards
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
