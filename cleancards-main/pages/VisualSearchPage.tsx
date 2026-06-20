import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Copy, Image, Database, Loader2, Upload, Camera, Eye } from "lucide-react";

type SearchMode = "duplicates" | "similar" | "database";

type DuplicateResult = {
  cardId: string;
  cardName: string;
  matchType: "exact" | "near" | "variant";
  confidence: number;
  reason: string;
};

type SimilarResult = {
  cardId: string;
  cardName: string;
  similarityType: "artwork" | "character" | "theme" | "series";
  similarityScore: number;
  reason: string;
};

type DatabaseResult = {
  identifiedCard: {
    cardName: string;
    setName: string;
    cardNumber: string;
    year: string;
    rarity: string;
    gameType: string;
    confidence: number;
  };
  alternativeMatches: Array<{
    cardName: string;
    setName: string;
    confidence: number;
  }>;
  visualClues: string[];
  summary: string;
};

export default function VisualSearchPage() {
  const { userId } = useAuth();
  const [mode, setMode] = useState<SearchMode>("duplicates");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<{
    duplicates?: { duplicates: DuplicateResult[]; summary: string };
    similar?: { similarCards: SimilarResult[]; summary: string };
    database?: DatabaseResult;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
      setResults(null);
    }
  };

  const handleSearch = async () => {
    if (!imageFile || !userId) {
      toast.error("Please select an image first");
      return;
    }

    setIsAnalyzing(true);
    try {
      // Upload image to storage
      const fileExt = imageFile.name.split(".").pop();
      const filePath = `search/${userId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(filePath, imageFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("card-images")
        .getPublicUrl(filePath);

      // Call visual similarity function
      const { data, error } = await supabase.functions.invoke("visual-similarity", {
        body: { imageUrl: urlData.publicUrl, mode },
      });

      if (error) throw error;

      if (data.success) {
        setResults((prev) => ({
          ...prev,
          [mode]: data.result,
        }));
        toast.success("Analysis complete!");
      } else {
        throw new Error(data.error || "Analysis failed");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getMatchTypeBadge = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      exact: "default",
      near: "secondary",
      variant: "outline",
    };
    return <Badge variant={variants[type] || "outline"}>{type}</Badge>;
  };

  const getSimilarityBadge = (type: string) => {
    const colors: Record<string, string> = {
      artwork: "bg-purple-500/20 text-purple-400",
      character: "bg-blue-500/20 text-blue-400",
      theme: "bg-green-500/20 text-green-400",
      series: "bg-orange-500/20 text-orange-400",
    };
    return <Badge className={colors[type] || ""}>{type}</Badge>;
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Search className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Visual Similarity Search</h1>
          <p className="text-muted-foreground">Find duplicates, similar cards, and identify unknowns</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Card Image
            </CardTitle>
            <CardDescription>Select or capture a card image to search</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />

            {imagePreview ? (
              <div className="relative aspect-[5/7] max-w-xs mx-auto rounded-lg overflow-hidden border border-border">
                <img
                  src={imagePreview}
                  alt="Selected card"
                  className="w-full h-full object-contain bg-muted"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="aspect-[5/7] max-w-xs mx-auto rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
              >
                <div className="p-4 rounded-full bg-muted">
                  <Camera className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Click to upload or capture</p>
              </div>
            )}

            <Tabs value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="duplicates" className="flex-1 gap-1">
                  <Copy className="h-4 w-4" />
                  <span className="hidden sm:inline">Duplicates</span>
                </TabsTrigger>
                <TabsTrigger value="similar" className="flex-1 gap-1">
                  <Image className="h-4 w-4" />
                  <span className="hidden sm:inline">Similar</span>
                </TabsTrigger>
                <TabsTrigger value="database" className="flex-1 gap-1">
                  <Database className="h-4 w-4" />
                  <span className="hidden sm:inline">Identify</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              className="w-full"
              onClick={handleSearch}
              disabled={!imageFile || isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Search {mode === "duplicates" ? "for Duplicates" : mode === "similar" ? "Similar Cards" : "Database"}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Search Results
            </CardTitle>
            <CardDescription>
              {mode === "duplicates"
                ? "Find duplicate cards in your collection"
                : mode === "similar"
                ? "Find visually similar cards"
                : "Identify card from database"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!results && !isAnalyzing && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Upload an image and search to see results</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="text-center py-12">
                <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin text-primary" />
                <p className="text-muted-foreground">Analyzing card image...</p>
              </div>
            )}

            {/* Duplicates Results */}
            {results?.duplicates && mode === "duplicates" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{results.duplicates.summary}</p>
                {results.duplicates.duplicates.length > 0 ? (
                  <div className="space-y-3">
                    {results.duplicates.duplicates.map((dup, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{dup.cardName}</span>
                          {getMatchTypeBadge(dup.matchType)}
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{dup.reason}</span>
                          <Badge variant="outline">{dup.confidence}% match</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center py-6 text-muted-foreground">No duplicates found</p>
                )}
              </div>
            )}

            {/* Similar Results */}
            {results?.similar && mode === "similar" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{results.similar.summary}</p>
                {results.similar.similarCards.length > 0 ? (
                  <div className="space-y-3">
                    {results.similar.similarCards.map((sim, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{sim.cardName}</span>
                          {getSimilarityBadge(sim.similarityType)}
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{sim.reason}</span>
                          <Badge variant="outline">{sim.similarityScore}% similar</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center py-6 text-muted-foreground">No similar cards found</p>
                )}
              </div>
            )}

            {/* Database Results */}
            {results?.database && mode === "database" && (
              <div className="space-y-4">
                {results.database.identifiedCard && (
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-lg">{results.database.identifiedCard.cardName}</h3>
                      <Badge>{results.database.identifiedCard.confidence}% confident</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Set:</span>{" "}
                        {results.database.identifiedCard.setName}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Number:</span>{" "}
                        {results.database.identifiedCard.cardNumber}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Year:</span>{" "}
                        {results.database.identifiedCard.year}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Rarity:</span>{" "}
                        {results.database.identifiedCard.rarity}
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Type:</span>{" "}
                        {results.database.identifiedCard.gameType}
                      </div>
                    </div>
                  </div>
                )}

                {results.database.alternativeMatches?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Alternative Matches</h4>
                    <div className="space-y-2">
                      {results.database.alternativeMatches.map((alt, i) => (
                        <div key={i} className="p-2 rounded bg-muted/50 flex justify-between text-sm">
                          <span>{alt.cardName} ({alt.setName})</span>
                          <Badge variant="outline">{alt.confidence}%</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {results.database.visualClues?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Visual Clues Detected</h4>
                    <div className="flex flex-wrap gap-1">
                      {results.database.visualClues.map((clue, i) => (
                        <Badge key={i} variant="secondary">{clue}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-sm text-muted-foreground">{results.database.summary}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
