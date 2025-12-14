import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface PriceJob {
  id: string;
  status: string;
  requested_count: number;
  processed_count: number;
  error: string | null;
}

export function BulkPSA10Update() {
  const { userId } = useAuth();
  const [isStarting, setIsStarting] = useState(false);
  const [currentJob, setCurrentJob] = useState<PriceJob | null>(null);
  const [polling, setPolling] = useState(false);

  // Poll for job updates
  useEffect(() => {
    if (!currentJob || currentJob.status === "done" || currentJob.status === "failed") {
      setPolling(false);
      return;
    }

    setPolling(true);
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("price_jobs")
        .select("*")
        .eq("id", currentJob.id)
        .single();

      if (data) {
        setCurrentJob(data as PriceJob);
        if (data.status === "done" || data.status === "failed") {
          setPolling(false);
          if (data.status === "done") {
            toast.success(`Updated ${data.processed_count} card prices`);
          } else {
            toast.error(data.error || "Job failed");
          }
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentJob]);

  // Check for existing running job on mount
  useEffect(() => {
    if (!userId) return;

    const checkExistingJob = async () => {
      const { data } = await supabase
        .from("price_jobs")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setCurrentJob(data as PriceJob);
      }
    };

    checkExistingJob();
  }, [userId]);

  const handleStartJob = async () => {
    if (!userId) {
      toast.error("Please sign in to update prices");
      return;
    }

    setIsStarting(true);
    try {
      // Create the job
      const { data: job, error: jobError } = await supabase
        .from("price_jobs")
        .insert({
          user_id: userId,
          status: "queued"
        })
        .select()
        .single();

      if (jobError) throw jobError;

      setCurrentJob(job as PriceJob);

      // Start the job
      const { error: invokeError } = await supabase.functions.invoke("run-psa10-job", {
        body: { job_id: job.id }
      });

      if (invokeError) {
        console.error("Failed to start job:", invokeError);
        toast.error("Failed to start price update job");
      } else {
        toast.success("Price update started");
      }
    } catch (error) {
      console.error("Failed to create job:", error);
      toast.error("Failed to create price update job");
    } finally {
      setIsStarting(false);
    }
  };

  const progress = currentJob?.requested_count 
    ? (currentJob.processed_count / currentJob.requested_count) * 100 
    : 0;

  const isRunning = currentJob?.status === "running" || currentJob?.status === "queued";

  return (
    <div className="space-y-4 p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">Bulk PSA 10 Price Update</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Update PSA 10 prices for all cards in your collection
          </p>
        </div>
        <Button
          onClick={handleStartJob}
          disabled={isStarting || isRunning}
          size="sm"
        >
          {isStarting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isRunning ? "Updating..." : "Update PSA 10 Prices"}
        </Button>
      </div>

      {currentJob && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {currentJob.processed_count} / {currentJob.requested_count || "?"} cards
            </span>
            <span className="flex items-center gap-1">
              {currentJob.status === "done" && (
                <>
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-success">Complete</span>
                </>
              )}
              {currentJob.status === "failed" && (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">Failed</span>
                </>
              )}
              {isRunning && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-primary">Running</span>
                </>
              )}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          {currentJob.error && (
            <p className="text-xs text-destructive">{currentJob.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
