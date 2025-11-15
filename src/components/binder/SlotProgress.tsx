import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface SlotProgressProps {
  total: number;
  processed: number;
  current?: string;
}

export function SlotProgress({ total, processed, current }: SlotProgressProps) {
  const percentage = total > 0 ? (processed / total) * 100 : 0;

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing Binder Page
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={percentage} className="h-2" />
        <div className="flex justify-between text-sm text-neutral-400">
          <span>
            {processed} of {total} cards processed
          </span>
          <span>{Math.round(percentage)}%</span>
        </div>
        {current && (
          <p className="text-xs text-neutral-500">
            Currently processing: {current}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
