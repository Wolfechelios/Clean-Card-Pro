import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, FolderUp } from "lucide-react";
import type { BatchJob } from "@/hooks/use-batch-scanner";

interface BatchQueueProps {
  jobs: BatchJob[];
  onProcess: () => void;
}

export function BatchQueue({ jobs, onProcess }: BatchQueueProps) {
  if (jobs.length === 0) return null;

  const pendingCount = jobs.filter(j => j.status === 'pending').length;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Batch Queue ({jobs.length} files)</CardTitle>
        <CardDescription>Process multiple cards at once</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div 
          className="grid gap-2 max-h-[400px] overflow-y-auto"
          role="list"
          aria-label="Batch queue"
        >
          {jobs.map(job => (
            <div 
              key={job.id} 
              className="flex items-center gap-3 rounded-lg border p-3"
              role="listitem"
            >
              {job.preview && (
                <img 
                  src={job.preview} 
                  alt="" 
                  className="h-12 w-12 rounded object-cover" 
                  aria-hidden="true"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{job.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {job.status === 'pending' && 'Waiting...'}
                  {job.status === 'processing' && 'Scanning...'}
                  {job.status === 'completed' && '✓ Complete'}
                  {job.status === 'error' && `Error: ${job.error}`}
                </p>
              </div>
              {job.status === 'processing' && (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Processing" />
              )}
              {job.status === 'completed' && (
                <CheckCircle className="h-4 w-4 text-success" aria-label="Complete" />
              )}
            </div>
          ))}
        </div>
        <Button 
          onClick={onProcess} 
          disabled={pendingCount === 0}
          className="w-full"
          size="lg"
        >
          <FolderUp className="mr-2 h-4 w-4" />
          Process All ({pendingCount} pending)
        </Button>
      </CardContent>
    </Card>
  );
}
