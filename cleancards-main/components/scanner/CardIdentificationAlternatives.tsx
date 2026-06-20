import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Alternative {
  card_name: string;
  card_set: string;
  confidence: number;
  reason: string;
}

interface CardIdentificationAlternativesProps {
  alternatives: Alternative[];
  onSelect: (alt: Alternative) => void;
}

export function CardIdentificationAlternatives({ alternatives, onSelect }: CardIdentificationAlternativesProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Alternative Matches</CardTitle>
        <CardDescription>Select an alternative if the primary identification doesn't match</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {alternatives.map((alt, index) => (
          <button
            key={index}
            onClick={() => onSelect(alt)}
            className="w-full p-3 rounded-lg border hover:border-primary hover:bg-accent transition-colors text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{alt.card_name}</div>
                <div className="text-sm text-muted-foreground truncate">{alt.card_set}</div>
                <div className="text-xs text-muted-foreground mt-1">{alt.reason}</div>
              </div>
              <Badge variant="outline">{Math.round(alt.confidence)}%</Badge>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
