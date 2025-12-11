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
import Card3DViewer from "@/components/Card3DViewer";
import { toast } from "sonner";
import { Pencil, Trash2, X, Save } from "lucide-react";

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
    }
  }, [card, open]);

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
            {/* 3D Viewer */}
            <div className="flex justify-center">
              <Card3DViewer
                frontImageUrl={card.image_url}
                width={400}
                height={300}
              />
            </div>

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
