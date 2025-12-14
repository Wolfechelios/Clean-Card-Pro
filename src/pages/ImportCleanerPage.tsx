import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Sparkles, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  ArrowRight,
  Play,
  ImageIcon,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NormalizeResult {
  id: string;
  name: string;
  newName?: string;
  game: string;
  confidence: number;
  changes: string[];
  flagged?: boolean;
  error?: string;
}

interface NormalizeStats {
  notNormalized: number;
  lowConfidence: number;
  normalized: number;
}

export default function ImportCleanerPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  const [stats, setStats] = useState<NormalizeStats>({ notNormalized: 0, lowConfidence: 0, normalized: 0 });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [results, setResults] = useState<NormalizeResult[]>([]);
  
  const [gameFilter, setGameFilter] = useState('all');
  const [batchSize, setBatchSize] = useState('100');
  const [statusFilter, setStatusFilter] = useState('not_normalized');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      loadStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadStats = async () => {
    setIsLoadingStats(true);
    try {
      const { data, error } = await supabase
        .from('cards')
        .select('normalized_at, normalization_confidence')
        .eq('user_id', user?.id);

      if (error) throw error;

      const counts = { notNormalized: 0, lowConfidence: 0, normalized: 0 };
      for (const card of data || []) {
        if (!card.normalized_at) {
          counts.notNormalized++;
        } else if ((card.normalization_confidence || 0) < 80) {
          counts.lowConfidence++;
        } else {
          counts.normalized++;
        }
      }
      setStats(counts);
    } catch (error: any) {
      console.error('Error loading stats:', error);
      toast.error('Failed to load normalization statistics');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const runNormalization = async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    setResults([]);
    setProgress({ processed: 0, total: 0 });

    try {
      const response = await supabase.functions.invoke('normalize-cards', {
        body: {
          limit: parseInt(batchSize),
          game: gameFilter === 'all' ? null : gameFilter,
          onlyIf: statusFilter,
          minConfidence: 80,
        },
      });

      if (response.error) throw response.error;

      const data = response.data;
      setResults(data.results || []);
      setProgress({ processed: data.processed, total: data.processed });

      const message = `Processed ${data.processed} cards: ${data.updated} updated, ${data.skipped} unchanged, ${data.flagged} flagged for review`;
      if (data.updated > 0) {
        toast.success(message);
      } else if (data.processed > 0) {
        toast.info(message);
      } else {
        toast.info('No cards found matching the filter criteria');
      }

      loadStats();
    } catch (error: any) {
      console.error('Normalization error:', error);
      toast.error(error.message || 'Failed to run normalization');
    } finally {
      setIsRunning(false);
    }
  };

  const runBackfillAfterNormalize = async () => {
    // Navigate to backfill page with pre-selected filters
    navigate('/image-backfill');
    toast.info('Run Image Backfill to fetch images for normalized cards');
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 80) {
      return <Badge className="bg-success/20 text-success border-success/30">{confidence}%</Badge>;
    } else if (confidence >= 60) {
      return <Badge className="bg-warning/20 text-warning border-warning/30">{confidence}%</Badge>;
    } else {
      return <Badge variant="destructive">{confidence}%</Badge>;
    }
  };

  if (authLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="h-6 w-6" />
            Import Cleaner
          </h1>
          <p className="text-muted-foreground text-sm">
            Normalize and standardize card data for better image matching
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats} disabled={isLoadingStats}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingStats ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.notNormalized}</p>
                <p className="text-xs text-muted-foreground">Not Normalized</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning/20 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.lowConfidence}</p>
                <p className="text-xs text-muted-foreground">Low Confidence</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.normalized}</p>
                <p className="text-xs text-muted-foreground">Normalized</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Run Normalization
          </CardTitle>
          <CardDescription>
            Clean card names, extract set codes, and standardize data for better matching
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Game Type</label>
              <Select value={gameFilter} onValueChange={setGameFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="mtg">Magic: The Gathering</SelectItem>
                  <SelectItem value="pokemon">Pokémon</SelectItem>
                  <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                  <SelectItem value="sports">Sports</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Filter</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_normalized">Not Normalized</SelectItem>
                  <SelectItem value="low_confidence">Low Confidence (&lt;80%)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Batch Size</label>
              <Select value={batchSize} onValueChange={setBatchSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 cards</SelectItem>
                  <SelectItem value="100">100 cards</SelectItem>
                  <SelectItem value="200">200 cards</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={runNormalization} 
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Normalize Cards
                </>
              )}
            </Button>
            
            {stats.normalized > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={runBackfillAfterNormalize}
                    >
                      <ImageIcon className="h-4 w-4 mr-2" />
                      Run Image Backfill
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Fetch images for normalized cards</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {isRunning && progress.total > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processing...</span>
                <span>{progress.processed} / {progress.total}</span>
              </div>
              <Progress value={(progress.processed / progress.total) * 100} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {results.filter(r => r.changes?.length > 0).length} cards updated, {' '}
              {results.filter(r => r.flagged).length} flagged for review
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {results.map((result) => (
                  <div 
                    key={result.id} 
                    className="p-3 rounded-lg bg-secondary/30 border border-border/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getConfidenceBadge(result.confidence)}
                          <Badge variant="outline" className="text-xs">{result.game}</Badge>
                          {result.flagged && (
                            <Badge className="bg-warning/20 text-warning border-warning/30">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Review
                            </Badge>
                          )}
                        </div>
                        
                        <div className="mt-2">
                          {result.newName && result.newName !== result.name ? (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-muted-foreground line-through">{result.name}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="font-medium">{result.newName}</span>
                            </div>
                          ) : (
                            <p className="font-medium text-sm">{result.name}</p>
                          )}
                        </div>
                        
                        {result.changes && result.changes.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {result.changes.map((change) => (
                              <Badge key={change} variant="secondary" className="text-xs">
                                {change}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {result.error && (
                          <p className="text-xs text-destructive mt-1">{result.error}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Info */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Sparkles className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-medium text-sm">Import Pipeline</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <Badge variant="outline">1. Import</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline" className="bg-primary/10">2. Normalize</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline">3. Backfill Images</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline">4. Manual Review</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Run normalization after importing cards to clean data, then use Image Backfill 
                to fetch images. Sports cards may require manual image attachment.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
