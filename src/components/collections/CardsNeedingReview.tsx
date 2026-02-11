import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Trash2
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
  const { cards, counts, loading, fetchCards, fetchCounts, markAsReviewed, dismissCard, deleteAllByFilter } = useCardsNeedingReview();
  const [activeTab, setActiveTab] = useState<ReviewReason | "all">("all");
  const [selectedCard, setSelectedCard] = useState<CardNeedingReview | null>(null);
  const [editValues, setEditValues] = useState({ card_name: "", card_set: "", rarity: "" });
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        body: { imageUrl: selectedCard.image_url },
      });

      if (error) throw error;

      if (data?.card) {
        setEditValues({
          card_name: data.card.card_name || editValues.card_name,
          card_set: data.card.card_set || editValues.card_set,
          rarity: data.card.rarity || editValues.rarity,
        });
        toast.success("Re-analysis complete - review the results");
      }
    } catch (err) {
      console.error("Re-analyze error:", err);
      toast.error("Failed to re-analyze card");
    } finally {
      setReanalyzing(false);
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchCounts}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
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

          <div className="grid md:grid-cols-2 gap-4">
            {/* Card List */}
            <div className="border rounded-lg">
              <div className="p-2 border-b bg-muted/50">
                <p className="text-sm font-medium">
                  {loading ? "Loading..." : `${cards.length} cards`}
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
                      <button
                        key={card.id}
                        className={`w-full p-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                          selectedCard?.id === card.id ? "bg-muted" : ""
                        }`}
                        onClick={() => setSelectedCard(card)}
                      >
                        {card.image_url && (
                          <img
                            src={card.image_url}
                            alt=""
                            className="h-12 w-9 object-cover rounded"
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
                          <span className="text-xs text-muted-foreground">
                            {Math.round(card.ocr_confidence)}%
                          </span>
                        )}
                      </button>
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
