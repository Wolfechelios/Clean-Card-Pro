import { Button } from "@/components/ui/button";
import { Microscope } from "lucide-react";

interface MicroscopePromptProps {
  reason: string;
  onAccept: () => void;
  onDismiss: () => void;
}

export function MicroscopePrompt({ reason, onAccept, onDismiss }: MicroscopePromptProps) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
      <Microscope className="h-5 w-5 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">Microscope verification recommended</p>
        <p className="text-xs text-muted-foreground">{reason}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={onDismiss}>Skip</Button>
        <Button size="sm" onClick={onAccept}>
          <Microscope className="mr-1 h-3 w-3" />
          Capture Detail
        </Button>
      </div>
    </div>
  );
}
