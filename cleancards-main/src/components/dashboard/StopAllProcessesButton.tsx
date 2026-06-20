import { Button } from "@/components/ui/button";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import { StopCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export function StopAllProcessesButton() {
  const { runningProcesses, stopAllProcesses } = useGlobalProcessControl();
  
  const hasRunningProcesses = runningProcesses.length > 0;

  const handleStopAll = () => {
    if (runningProcesses.length > 0) {
      stopAllProcesses();
      toast.success(`Stopped ${runningProcesses.length} running process(es)`);
    } else {
      toast.info("No processes currently running");
    }
  };

  return (
    <div className="flex items-center gap-3">
      {hasRunningProcesses && (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-warning" />
          <Badge variant="outline" className="gap-1.5">
            {runningProcesses.length} process{runningProcesses.length !== 1 ? 'es' : ''} running
          </Badge>
        </div>
      )}
      <Button 
        variant={hasRunningProcesses ? "destructive" : "outline"}
        onClick={handleStopAll}
        className="gap-2"
      >
        <StopCircle className="h-4 w-4" />
        Stop All Processes
      </Button>
    </div>
  );
}
