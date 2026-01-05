import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle, Image } from "lucide-react";
import { Progress } from "@/components/ui/progress";

import type { BatchJob } from "@/hooks/use-batch-scanner";

interface BatchProgressProps {
  cards: BatchJob[];
  total: number;
  completed: number;
}

export function BatchProgress({ cards, total, completed }: BatchProgressProps) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Scanning Progress</span>
          <span className="text-sm text-muted-foreground">
            {completed} / {total}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percentage} className="h-2" />
        
        <div className="max-h-96 overflow-y-auto space-y-2">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
            >
              {card.status === "completed" && (
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              )}
              {card.status === "processing" && (
                <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
              )}
              {card.status === "error" && (
                <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              )}
              {card.status === "pending" && (
                <Image className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {card.fileName || card.file.name}
                </p>
                {card.error && (
                  <p className="text-xs text-destructive mt-1">{card.error}</p>
                )}
                {card.status === "processing" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Analyzing card...
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
