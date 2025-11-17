import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Edit2, AlertCircle } from "lucide-react";

interface CardData {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  game_type: string | null;
  sport_type: string | null;
  year: string | null;
  manufacturer: string | null;
  confidence: number;
  description: string;
}

interface Alternative {
  card_name: string;
  card_set: string;
  confidence: number;
  reason: string;
}

interface CardIdentificationEditorProps {
  primaryCard: CardData;
  alternatives?: Alternative[];
  imageUrl?: string;
  onConfirm: (editedCard: CardData) => void;
  onSelectAlternative: (alternative: Alternative) => void;
  onCancel: () => void;
}

export function CardIdentificationEditor({
  primaryCard,
  alternatives = [],
  imageUrl,
  onConfirm,
  onSelectAlternative,
  onCancel,
}: CardIdentificationEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(primaryCard.card_name);
  const [editedSet, setEditedSet] = useState(primaryCard.card_set || "");

  const handleConfirm = () => {
    onConfirm({
      ...primaryCard,
      card_name: editedName,
      card_set: editedSet || null,
    });
  };

  const handleSelectAlternative = (alt: Alternative) => {
    setEditedName(alt.card_name);
    setEditedSet(alt.card_set);
    setIsEditing(false);
  };

  const showAlternatives = alternatives.length > 0 && primaryCard.confidence < 0.95;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {primaryCard.confidence >= 0.95 ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-500" />
              )}
              Card Identified
            </CardTitle>
            <Badge variant={primaryCard.confidence >= 0.95 ? "default" : "secondary"}>
              {Math.round(primaryCard.confidence * 100)}% confidence
            </Badge>
          </div>
          {showAlternatives && (
            <CardDescription className="text-yellow-600 dark:text-yellow-500">
              Confidence is below 95%. Please review alternatives or edit manually.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {imageUrl && (
            <div className="flex justify-center">
              <img
                src={imageUrl}
                alt="Card preview"
                className="max-h-48 rounded-lg border object-contain"
              />
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cardName" className="flex items-center justify-between">
                Card Name
                {!isEditing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="h-6 px-2"
                  >
                    <Edit2 className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                )}
              </Label>
              <Input
                id="cardName"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                disabled={!isEditing}
                className="font-medium"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cardSet">Card Set</Label>
              <Input
                id="cardSet"
                value={editedSet}
                onChange={(e) => setEditedSet(e.target.value)}
                disabled={!isEditing}
              />
            </div>

            {primaryCard.card_number && (
              <div className="text-sm text-muted-foreground">
                Card #{primaryCard.card_number}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={handleConfirm} className="flex-1">
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirm & Save
            </Button>
            <Button onClick={onCancel} variant="outline">
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      {showAlternatives && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Alternative Matches</CardTitle>
            <CardDescription>
              Select an alternative if the primary identification doesn't match
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {alternatives.map((alt, index) => (
              <button
                key={index}
                onClick={() => handleSelectAlternative(alt)}
                className="w-full p-3 rounded-lg border hover:border-primary hover:bg-accent transition-colors text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{alt.card_name}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {alt.card_set}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {alt.reason}
                    </div>
                  </div>
                  <Badge variant="outline">
                    {Math.round(alt.confidence * 100)}%
                  </Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
