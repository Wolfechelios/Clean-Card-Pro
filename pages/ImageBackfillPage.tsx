import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ImageIcon, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Link2, 
  Play,
  Info
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BackfillResult {
  id: string;
  name: string;
  game: string;
  status: 'ok' | 'failed' | 'needs_review';
  error?: string;
}

interface BackfillStats {
  missing: number;
  failed: number;
  needs_review: number;
  ok: number;
}

export default function ImageBackfillPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  const [stats, setStats] = useState<BackfillStats>({ missing: 0, failed: 0, needs_review: 0, ok: 0 });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [results, setResults] = useState<BackfillResult[]>([]);
  
  const [gameFilter, setGameFilter] = useState('all');
  const [batchSize, setBatchSize] = useState('50');
  const [statusFilter, setStatusFilter] = useState('missing');
  
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [attachCardId, setAttachCardId] = useState('');
  const [attachCardName, setAttachCardName] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [isAttaching, setIsAttaching] = useState(false);

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
        .select('image_status')
        .eq('user_id', user?.id);

      if (error) throw error;

      const counts = { missing: 0, failed: 0, needs_review: 0, ok: 0 };
      for (const card of data || []) {
        const status = card.image_status || 'missing';
        if (status in counts) {
          counts[status as keyof BackfillStats]++;
        }
      }
      setStats(counts);
    } catch (error: any) {
      console.error('Error loading stats:', error);
      toast.error('Failed to load image statistics');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const runBackfill = async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    setResults([]);
    setProgress({ processed: 0, total: 0 });

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('backfill-images', {
        body: {
          limit: parseInt(batchSize),
          game: gameFilter === 'all' ? null : gameFilter,
          onlyStatus: statusFilter,
          concurrency: 3,
        },
      });

      if (response.error) throw response.error;

      const data = response.data;
      setResults(data.results || []);
      setProgress({ processed: data.processed, total: data.processed });

      const message = `Processed ${data.processed} cards: ${data.succeeded} succeeded, ${data.failed} failed, ${data.needs_review} need review`;
      if (data.succeeded > 0) {
        toast.success(message);
      } else if (data.processed > 0) {
        toast.info(message);
      } else {
        toast.info('No cards found matching the filter criteria');
      }

      loadStats();
    } catch (error: any) {
      console.error('Backfill error:', error);
      toast.error(error.message || 'Failed to run backfill');
    } finally {
      setIsRunning(false);
    }
  };

  const openAttachDialog = (cardId: string, cardName: string) => {
    setAttachCardId(cardId);
    setAttachCardName(cardName);
    setAttachUrl('');
    setAttachDialogOpen(true);
  };

  const handleAttachImage = async () => {
    if (!attachUrl.trim() || !attachCardId) return;

    setIsAttaching(true);
    try {
      const response = await supabase.functions.invoke('attach-image', {
        body: {
          cardId: attachCardId,
          remoteImageUrl: attachUrl.trim(),
        },
      });

      if (response.error) throw response.error;

      if (response.data.success) {
        toast.success(`Image attached to ${attachCardName}`);
        setAttachDialogOpen(false);
        
        // Update the result in the list
        setResults(prev => prev.map(r => 
          r.id === attachCardId ? { ...r, status: 'ok' as const, error: undefined } : r
        ));
        loadStats();
      } else {
        throw new Error(response.data.error || 'Failed to attach image');
      }
    } catch (error: any) {
      console.error('Attach error:', error);
      toast.error(error.message || 'Failed to attach image');
    } finally {
      setIsAttaching(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ok':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'needs_review':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><AlertTriangle className="h-3 w-3 mr-1" />Review</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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
            <h1 className="text-2xl font-bold">Image Backfill</h1>
            <p className="text-muted-foreground text-sm">
              Find and download missing card images from official databases
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadStats} disabled={isLoadingStats}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingStats ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card/50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.missing}</p>
                  <p className="text-xs text-muted-foreground">Missing</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-destructive/20 rounded-lg">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.failed}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
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
                  <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.needs_review}</p>
                  <p className="text-xs text-muted-foreground">Need Review</p>
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
                  <p className="text-2xl font-bold">{isLoadingStats ? '-' : stats.ok}</p>
                  <p className="text-xs text-muted-foreground">Complete</p>
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
              Run Backfill
            </CardTitle>
            <CardDescription>
              Automatically find and download images from official card databases
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Game Type</Label>
                <Select value={gameFilter} onValueChange={setGameFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Games</SelectItem>
                    <SelectItem value="mtg">Magic: The Gathering</SelectItem>
                    <SelectItem value="pokemon">Pokémon</SelectItem>
                    <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                    <SelectItem value="sports">
                      <span className="flex items-center gap-2">
                        Sports
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>Sports cards don't have a universal image API. Cards will be marked for manual review.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status Filter</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="missing">Missing Images</SelectItem>
                    <SelectItem value="failed">Failed (Retry)</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Batch Size</Label>
                <Select value={batchSize} onValueChange={setBatchSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 cards</SelectItem>
                    <SelectItem value="50">50 cards</SelectItem>
                    <SelectItem value="100">100 cards</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button 
                onClick={runBackfill} 
                disabled={isRunning}
                className="flex-1 md:flex-none"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Backfill
                  </>
                )}
              </Button>
              
              {stats.failed > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStatusFilter('failed');
                    runBackfill();
                  }}
                  disabled={isRunning}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Failed ({stats.failed})
                </Button>
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
                {results.filter(r => r.status === 'ok').length} succeeded, {' '}
                {results.filter(r => r.status === 'failed').length} failed, {' '}
                {results.filter(r => r.status === 'needs_review').length} need review
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {results.map((result) => (
                    <div 
                      key={result.id} 
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {getStatusBadge(result.status)}
                        <div className="min-w-0">
                          <p className="font-medium truncate">{result.name}</p>
                          <p className="text-xs text-muted-foreground">{result.game}</p>
                          {result.error && (
                            <p className="text-xs text-destructive mt-1">{result.error}</p>
                          )}
                        </div>
                      </div>
                      
                      {result.status === 'needs_review' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAttachDialog(result.id, result.name)}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          Attach
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Sports Info Card */}
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-sm">About Sports Card Images</p>
                <p className="text-xs text-muted-foreground">
                  Sports cards don't have a universal free image API like TCG cards do. 
                  Cards will be marked as "needs review" so you can manually attach images 
                  from trusted sources like eBay, COMC, or Beckett. Paste the direct image URL 
                  and we'll download and store it for you.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attach Image Dialog */}
        <Dialog open={attachDialogOpen} onOpenChange={setAttachDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Attach Image</DialogTitle>
              <DialogDescription>
                Paste a direct image URL for "{attachCardName}"
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="imageUrl">Image URL</Label>
                <Input
                  id="imageUrl"
                  placeholder="https://i.ebayimg.com/images/..."
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use a direct link to a JPG, PNG, or WebP image. Right-click an image and select "Copy image address".
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAttachDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAttachImage} 
                disabled={!attachUrl.trim() || isAttaching}
              >
                {isAttaching ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Attaching...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4 mr-2" />
                    Attach Image
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
