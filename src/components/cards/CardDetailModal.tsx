import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import Card3DViewer from "@/components/Card3DViewer";
import { PSA10PriceSection } from "@/components/pricing/PSA10PriceSection";
import { CardImageActions } from "@/components/collections/CardImageActions";
import { toast } from "sonner";
import { Pencil, Trash2, X, Save, Search, ImageIcon, CheckCircle2, XCircle, Box, Image } from "lucide-react";

export interface CardData {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  image_url: string;
  thumbnail_url?: string | null;
  current_price_raw: number | null;
  collection_name: string | null;
  condition: string | null;
  created_at?: string;
  game_type: string | null;
  sport_type: string | null;
  psa10_price?: number | null;
  psa10_currency?: string | null;
  psa10_source?: string | null;
  psa10_updated_at?: string | null;
  psa10_match_confidence?: number | null;
  psa10_source_ref?: string | null;
  psa10_locked?: boolean;
  image_locked?: boolean;
  image_source?: string | null;
}

interface CardDetailModalProps {
  card: CardData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: (updatedCard: CardData) => void;
  onDelete?: (cardId: string) => void;
}

export function CardDetailModal({
  card,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
}: CardDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [cardState, setCardState] = useState<CardData | null>(null);
  
  // Keep local card state for PSA10 updates
  useEffect(() => {
    if (card) {
      setCardState(card);
    }
  }, [card]);
  const [editData, setEditData] = useState({
    card_name: "",
    card_set: "",
    card_number: "",
    rarity: "",
    condition: "",
    collection_name: "",
    game_type: "",
    sport_type: "",
  });

  // Reset edit state when card changes or modal closes
  useEffect(() => {
    if (card) {
      setEditData({
        card_name: card.card_name || "",
        card_set: card.card_set || "",
        card_number: card.card_number || "",
        rarity: card.rarity || "",
        condition: card.condition || "",
        collection_name: card.collection_name || "",
        game_type: card.game_type || "",
        sport_type: card.sport_type || "",
      });
    }
    if (!open) {
      setIsEditing(false);
      setShowVerification(false);
      setReferenceImageUrl(null);
    }
  }, [card, open]);

  // Look up reference image from card databases
  const handleVerifyCard = async () => {
    if (!card) return;

    try {
      setIsVerifying(true);
      setShowVerification(true);
      setReferenceImageUrl(null);

      const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
        body: {
          cardName: card.card_name,
          cardSet: card.card_set,
          gameType: card.game_type || card.sport_type,
        },
      });

      if (error) throw error;

      if (data?.imageUrl) {
        setReferenceImageUrl(data.imageUrl);
      } else {
        toast.error("Could not find reference image");
      }
    } catch (error) {
      console.error("Error verifying card:", error);
      toast.error("Failed to look up card image");
    } finally {
      setIsVerifying(false);
    }
  };

  // Confirm verification and use reference image if card has no valid image
  const handleConfirmVerification = async () => {
    if (!card || !referenceImageUrl) return;

    const hasNoImage = !card.image_url || card.image_url.includes('placehold.co') || card.image_url.includes('placeholder');
    
    if (hasNoImage && referenceImageUrl && !referenceImageUrl.includes('placehold.co')) {
      try {
        setIsSaving(true);
        
        const { error } = await supabase
          .from("cards")
          .update({
            image_url: referenceImageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", card.id);

        if (error) throw error;

        const updatedCard: CardData = {
          ...card,
          image_url: referenceImageUrl,
        };

        toast.success("Card image updated with reference image");
        onUpdate?.(updatedCard);
      } catch (error) {
        console.error("Error updating card image:", error);
        toast.error("Failed to update card image");
      } finally {
        setIsSaving(false);
      }
    } else {
      toast.success("Card verified");
    }
    
    setShowVerification(false);
    setReferenceImageUrl(null);
  };

  const handleSave = async () => {
    if (!card) return;

    try {
      setIsSaving(true);

      const { error } = await supabase
        .from("cards")
        .update({
          card_name: editData.card_name,
          card_set: editData.card_set || null,
          card_number: editData.card_number || null,
          rarity: editData.rarity || null,
          condition: editData.condition || null,
          collection_name: editData.collection_name || null,
          game_type: editData.game_type || null,
          sport_type: editData.sport_type || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id);

      if (error) throw error;

      const updatedCard: CardData = {
        ...card,
        card_name: editData.card_name,
        card_set: editData.card_set || null,
        card_number: editData.card_number || null,
        rarity: editData.rarity || null,
        condition: editData.condition || null,
        collection_name: editData.collection_name || null,
        game_type: editData.game_type || null,
        sport_type: editData.sport_type || null,
      };

      toast.success("Card updated successfully");
      setIsEditing(false);
      onUpdate?.(updatedCard);
    } catch (error) {
      console.error("Error updating card:", error);
      toast.error("Failed to update card");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!card) return;

    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("id", card.id);

      if (error) throw error;

      toast.success("Card deleted successfully");
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onDelete?.(card.id);
    } catch (error) {
      console.error("Error deleting card:", error);
      toast.error("Failed to delete card");
    }
  };

  if (!card) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle className="text-xl">
                  {isEditing ? "Edit Card" : card.card_name}
                </DialogTitle>
                <DialogDescription>
                  {!isEditing && (
                    <>
                      {card.card_set || "Unknown Set"}{" "}
                      {card.card_number && `• #${card.card_number}`}
                    </>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Image Verification Section */}
            {showVerification ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary" />
                    Image Verification
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowVerification(false);
                      setReferenceImageUrl(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {/* Your Scanned Image */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Your Scanned Image</Label>
                    <div className="relative aspect-[3/4] bg-secondary/50 rounded-lg overflow-hidden border border-border">
                      {card.image_url && !card.image_url.includes('placehold.co') && !card.image_url.includes('placeholder') ? (
                        <img
                          src={card.image_url}
                          alt="Scanned card"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="text-center text-muted-foreground">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2" />
                            <p className="text-xs">No scanned image</p>
                            <p className="text-xs mt-1 font-medium">{card.card_name}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Reference Image */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Reference Image (from Database)</Label>
                    <div className="relative aspect-[3/4] bg-secondary/50 rounded-lg overflow-hidden border border-border">
                      {isVerifying ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="text-center space-y-2">
                            <Skeleton className="w-16 h-16 mx-auto rounded" />
                            <p className="text-xs text-muted-foreground">Looking up...</p>
                          </div>
                        </div>
                      ) : referenceImageUrl ? (
                        <img
                          src={referenceImageUrl}
                          alt="Reference card"
                          className="w-full h-full object-contain"
                          onError={() => {
                            setReferenceImageUrl(`https://placehold.co/300x400/1a1a2e/eee?text=${encodeURIComponent(card.card_name.substring(0, 20))}`);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="text-center text-muted-foreground">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2" />
                            <p className="text-xs">No image found</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Compare your scanned image with the reference to verify card identification
                </p>
                
                {/* Verification Actions */}
                {referenceImageUrl && !isVerifying && (
                  <div className="flex justify-center gap-3 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowVerification(false);
                        setReferenceImageUrl(null);
                      }}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleConfirmVerification}
                      disabled={isSaving}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {(!card.image_url || card.image_url.includes('placehold.co')) 
                        ? "Use This Image" 
                        : "Confirm Match"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* Card Image Display with 2D/3D Toggle */
              <div className="space-y-3">
                {card.image_url && !card.image_url.includes('placehold.co') && (
                  <div className="flex justify-center gap-2">
                    <Button
                      variant={viewMode === '2d' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('2d')}
                    >
                      <Image className="h-4 w-4 mr-1" />
                      2D
                    </Button>
                    <Button
                      variant={viewMode === '3d' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('3d')}
                    >
                      <Box className="h-4 w-4 mr-1" />
                      3D
                    </Button>
                  </div>
                )}
                <div className="flex justify-center">
                  {card.image_url && !card.image_url.includes('placehold.co') ? (
                    viewMode === '3d' ? (
                      <Card3DViewer
                        frontImageUrl={card.image_url}
                        width={400}
                        height={300}
                      />
                    ) : (
                      <div className="relative w-full max-w-[300px] aspect-[3/4] bg-secondary/30 rounded-xl overflow-hidden border border-border">
                        <img
                          src={card.image_url}
                          alt={card.card_name}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            )}

            {isEditing ? (
              /* Edit Form */
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="card_name">Card Name</Label>
                    <Input
                      id="card_name"
                      value={editData.card_name}
                      onChange={(e) =>
                        setEditData({ ...editData, card_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="card_set">Card Set</Label>
                    <Input
                      id="card_set"
                      value={editData.card_set}
                      onChange={(e) =>
                        setEditData({ ...editData, card_set: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="card_number">Card Number</Label>
                    <Input
                      id="card_number"
                      value={editData.card_number}
                      onChange={(e) =>
                        setEditData({ ...editData, card_number: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="rarity">Rarity</Label>
                    <Input
                      id="rarity"
                      placeholder="e.g., Common, Rare, Ultra Rare"
                      value={editData.rarity}
                      onChange={(e) =>
                        setEditData({ ...editData, rarity: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="condition">Condition</Label>
                    <Select
                      value={editData.condition}
                      onValueChange={(value) =>
                        setEditData({ ...editData, condition: value })
                      }
                    >
                      <SelectTrigger id="condition">
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Mint">Mint</SelectItem>
                        <SelectItem value="Near Mint">Near Mint</SelectItem>
                        <SelectItem value="Excellent">Excellent</SelectItem>
                        <SelectItem value="Good">Good</SelectItem>
                        <SelectItem value="Light Play">Light Play</SelectItem>
                        <SelectItem value="Played">Played</SelectItem>
                        <SelectItem value="Poor">Poor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="collection_name">Collection Name</Label>
                    <Input
                      id="collection_name"
                      value={editData.collection_name}
                      onChange={(e) =>
                        setEditData({ ...editData, collection_name: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="game_type">Game Type</Label>
                    <Input
                      id="game_type"
                      placeholder="e.g., Pokemon, Yu-Gi-Oh!, MTG"
                      value={editData.game_type}
                      onChange={(e) =>
                        setEditData({ ...editData, game_type: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="sport_type">Sport Type</Label>
                    <Input
                      id="sport_type"
                      placeholder="e.g., Baseball, Basketball"
                      value={editData.sport_type}
                      onChange={(e) =>
                        setEditData({ ...editData, sport_type: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* View Mode */
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Condition</Label>
                    <p className="font-medium">{card.condition || "Not specified"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Rarity</Label>
                    <p className="font-medium">{card.rarity || "Unknown"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Game Type</Label>
                    <p className="font-medium">{card.game_type || "Not specified"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Sport Type</Label>
                    <p className="font-medium">{card.sport_type || "Not specified"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Collection</Label>
                    <p className="font-medium">{card.collection_name || "No collection"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Current Value</Label>
                    <p className="font-medium text-lg text-primary">
                      {card.current_price_raw
                        ? `$${card.current_price_raw.toFixed(2)}`
                        : "N/A"}
                    </p>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  {card.rarity && <Badge variant="secondary">{card.rarity}</Badge>}
                  {card.condition && <Badge variant="outline">{card.condition}</Badge>}
                  {card.game_type && <Badge>{card.game_type}</Badge>}
                </div>

                {/* Image Actions */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-3">Image Settings</h4>
                  <CardImageActions
                    cardId={card.id}
                    imageUrl={card.image_url}
                    imageLocked={card.image_locked || false}
                    imageSource={card.image_source || null}
                    onImageUpdated={async () => {
                      const { data } = await supabase
                        .from("cards")
                        .select("image_url, thumbnail_url, image_locked, image_source")
                        .eq("id", card.id)
                        .single();
                      if (data && cardState) {
                        setCardState({ ...cardState, ...data });
                        onUpdate?.({ ...card, ...data });
                      }
                    }}
                  />
                </div>

                {/* PSA 10 Price Section */}
                <PSA10PriceSection
                  cardId={card.id}
                  price={cardState?.psa10_price}
                  currency={cardState?.psa10_currency || "USD"}
                  source={cardState?.psa10_source}
                  updatedAt={cardState?.psa10_updated_at}
                  confidence={cardState?.psa10_match_confidence}
                  sourceRef={cardState?.psa10_source_ref}
                  locked={cardState?.psa10_locked}
                  onUpdate={async () => {
                    // Refetch card data to get updated PSA10 info
                    const { data } = await supabase
                      .from("cards")
                      .select("psa10_price, psa10_currency, psa10_source, psa10_updated_at, psa10_match_confidence, psa10_source_ref, psa10_locked")
                      .eq("id", card.id)
                      .single();
                    if (data && cardState) {
                      setCardState({ ...cardState, ...data });
                    }
                  }}
                />
              </>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <Button
                  variant="outline"
                  onClick={handleVerifyCard}
                  disabled={isVerifying}
                >
                  <Search className="h-4 w-4 mr-2" />
                  {isVerifying ? "Verifying..." : "Verify"}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{card.card_name}"? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
