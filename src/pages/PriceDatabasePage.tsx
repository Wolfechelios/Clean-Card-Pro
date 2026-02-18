import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Database, Trash2, CheckCircle2, XCircle, BarChart3, FileSpreadsheet, AlertCircle } from "lucide-react";
import {
  parseXLSXFile,
  importParsedSets,
  getSetCompletion,
  type ParsedSet,
  type SetCompletion,
} from "@/lib/priceChartingImport";

export default function PriceDatabasePage() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  return <PriceDBContent userId={session.user.id} />;
}

interface SetRow {
  id: string;
  game: string;
  set_code: string | null;
  set_name: string;
  total_cards: number;
  imported_at: string;
}

function PriceDBContent({ userId }: { userId: string }) {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [pendingSets, setPendingSets] = useState<ParsedSet[]>([]);
  const [completion, setCompletion] = useState<SetCompletion | null>(null);
  const [loadingCompletion, setLoadingCompletion] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSets = useCallback(async () => {
    const { data } = await supabase
      .from("pc_sets")
      .select("id, game, set_code, set_name, total_cards, imported_at")
      .eq("user_id", userId)
      .order("imported_at", { ascending: false });
    setSets(data || []);
  }, [userId]);

  useEffect(() => { fetchSets(); }, [fetchSets]);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setProgressMsg("Parsing files...");
    const allSets: ParsedSet[] = [];

    for (const file of Array.from(files)) {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseXLSXFile(buffer);
        allSets.push(...parsed);
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err);
        toast.error(`Failed to parse ${file.name}`);
      }
    }

    if (allSets.length === 0) {
      toast.error("No valid data found in files");
      setProgressMsg("");
      return;
    }

    setPendingSets(allSets);
    setProgressMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const confirmImport = async () => {
    if (pendingSets.length === 0) return;
    setImporting(true);
    setProgress(0);
    setProgressMsg("Importing...");

    try {
      const result = await importParsedSets(userId, pendingSets, (done, total) => {
        setProgress(Math.round((done / total) * 100));
      });

      toast.success(`Imported ${result.cardsImported} cards across ${result.setsImported} new sets${result.setsUpdated ? `, updated ${result.setsUpdated} sets` : ""}`);
      setPendingSets([]);
      fetchSets();
    } catch (err) {
      console.error("Import error:", err);
      toast.error("Import failed");
    } finally {
      setImporting(false);
      setProgress(0);
      setProgressMsg("");
    }
  };

  const deleteSet = async (setId: string) => {
    const { error } = await supabase.from("pc_sets").delete().eq("id", setId);
    if (error) {
      toast.error("Failed to delete set");
    } else {
      toast.success("Set deleted");
      fetchSets();
      if (completion?.set_id === setId) setCompletion(null);
    }
  };

  const viewCompletion = async (setId: string) => {
    setLoadingCompletion(true);
    const result = await getSetCompletion(userId, setId);
    setCompletion(result);
    setLoadingCompletion(false);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Price Database</h1>
        <p className="text-sm text-muted-foreground">Import PriceCharting XLSX files for instant offline pricing &amp; set completion tracking</p>
      </div>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="sets">My Sets ({sets.length})</TabsTrigger>
          {completion && <TabsTrigger value="completion">Set Tracker</TabsTrigger>}
        </TabsList>

        {/* ── Import Tab ─────────────────────── */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Import XLSX Files</CardTitle>
              <CardDescription>Upload one or more PriceCharting XLSX exports. Sets are detected from internal data, not filenames.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Expected columns: set_name, card_name, card_number, variant, ungraded_price, graded_price, grade9_price, psa10_price
                </AlertDescription>
              </Alert>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
                disabled={importing}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={importing} variant="outline" className="w-full">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Select XLSX Files
              </Button>

              {/* Preview pending import */}
              {pendingSets.length > 0 && !importing && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Detected {pendingSets.length} set(s):</h4>
                  {pendingSets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div>
                        <div className="font-medium text-sm">{s.set_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.game.toUpperCase()} {s.set_code && `• ${s.set_code}`} • {s.cards.length} cards
                        </div>
                      </div>
                      <Badge variant="secondary">{s.cards.length} cards</Badge>
                    </div>
                  ))}
                  <Button onClick={confirmImport} className="w-full">
                    <Database className="h-4 w-4 mr-2" />
                    Import {pendingSets.reduce((s, p) => s + p.cards.length, 0)} Cards
                  </Button>
                </div>
              )}

              {importing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{progressMsg}</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sets Tab ───────────────────────── */}
        <TabsContent value="sets" className="space-y-4">
          {sets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No sets imported yet. Upload PriceCharting XLSX files to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Set</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Game</TableHead>
                      <TableHead className="text-right">Cards</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sets.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium text-sm">{s.set_name}</TableCell>
                        <TableCell><Badge variant="outline">{s.set_code || "—"}</Badge></TableCell>
                        <TableCell className="text-xs uppercase">{s.game}</TableCell>
                        <TableCell className="text-right">{s.total_cards}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => viewCompletion(s.id)}>
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteSet(s.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Completion Tab ─────────────────── */}
        {completion && (
          <TabsContent value="completion" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{completion.set_name} {completion.set_code && `(${completion.set_code})`}</CardTitle>
                <CardDescription>
                  {completion.owned_cards} / {completion.total_cards} cards owned
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Completion</span>
                    <span>{completion.completion_pct}%</span>
                  </div>
                  <Progress value={completion.completion_pct} />
                </div>

                {completion.missing.length > 0 ? (
                  <>
                    <h4 className="text-sm font-semibold">Missing Cards ({completion.missing.length})</h4>
                    <div className="max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Card</TableHead>
                            <TableHead>Variant</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {completion.missing.map((c, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{c.card_number || "—"}</TableCell>
                              <TableCell className="text-sm">{c.card_name}</TableCell>
                              <TableCell className="text-xs">{c.variant || "—"}</TableCell>
                              <TableCell className="text-right text-sm">
                                {c.ungraded_price ? `$${c.ungraded_price.toFixed(2)}` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Total missing value: ${completion.missing.reduce((s, c) => s + (c.ungraded_price || 0), 0).toFixed(2)}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-2" />
                    <p className="font-medium">Set Complete!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
