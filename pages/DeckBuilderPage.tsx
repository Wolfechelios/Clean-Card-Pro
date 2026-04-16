import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildDeck, DeckBuild, DeckMode, GameType } from "@/lib/deckBuilder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Wand2, 
  DollarSign, 
  Swords, 
  Loader2, 
  TrendingUp, 
  ShoppingCart,
  AlertTriangle,
  Sparkles,
  Layers,
  Target
} from "lucide-react";

export default function DeckBuilderPage() {
  const [mode, setMode] = useState<DeckMode>("value");
  const [gameType, setGameType] = useState<GameType>("all");
  const [setFilter, setSetFilter] = useState("");
  const [deckSize, setDeckSize] = useState(60);
  const [useCollectionOnly, setUseCollectionOnly] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [deckResult, setDeckResult] = useState<DeckBuild | null>(null);

  // Get available game types from collection
  const { data: gameTypes } = useQuery({
    queryKey: ["deck-builder-game-types"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cards")
        .select("game_type")
        .not("game_type", "is", null);
      
      const uniqueTypes = [...new Set(data?.map(c => c.game_type).filter(Boolean))];
      return uniqueTypes as string[];
    },
  });

  // Get available sets for selected game type
  const { data: availableSets } = useQuery({
    queryKey: ["deck-builder-sets", gameType],
    queryFn: async () => {
      let query = supabase.from("cards").select("card_set").not("card_set", "is", null);
      if (gameType !== "all") {
        query = query.eq("game_type", gameType);
      }
      const { data } = await query;
      const uniqueSets = [...new Set(data?.map(c => c.card_set).filter(Boolean))];
      return uniqueSets as string[];
    },
    enabled: true,
  });

  const handleBuildDeck = async () => {
    setIsBuilding(true);
    try {
      const result = await buildDeck({
        mode,
        gameType,
        setFilter: setFilter || undefined,
        deckSize,
        useCollectionOnly,
      });

      if (result.success && result.deck) {
        setDeckResult(result.deck);
        toast.success(`${result.deck.deckName} built successfully!`);
      } else {
        toast.error(result.error || "Failed to build deck");
      }
    } catch (error) {
      toast.error("Failed to build deck");
    } finally {
      setIsBuilding(false);
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "meta": return "bg-purple-500";
      case "regional": return "bg-blue-500";
      case "locals": return "bg-green-500";
      default: return "bg-muted";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "must-have": return "destructive";
      case "recommended": return "default";
      default: return "secondary";
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
          <Wand2 className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Deck Builder</h1>
          <p className="text-muted-foreground">Build optimal decks for value or battle</p>
        </div>
      </div>

      {/* Configuration Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Build Configuration
          </CardTitle>
          <CardDescription>Configure your deck building preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mode Selection */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              variant={mode === "value" ? "default" : "outline"}
              className="flex-1 h-20 flex-col gap-2"
              onClick={() => setMode("value")}
            >
              <DollarSign className="h-6 w-6" />
              <span>Value Deck</span>
              <span className="text-xs opacity-70">Maximize monetary value</span>
            </Button>
            <Button
              variant={mode === "battle" ? "default" : "outline"}
              className="flex-1 h-20 flex-col gap-2"
              onClick={() => setMode("battle")}
            >
              <Swords className="h-6 w-6" />
              <span>Battle Deck</span>
              <span className="text-xs opacity-70">Competitive power</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Game Type */}
            <div className="space-y-2">
              <Label>Game Type</Label>
              <Select value={gameType} onValueChange={(v) => setGameType(v as GameType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select game" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="Yu-Gi-Oh!">Yu-Gi-Oh!</SelectItem>
                  <SelectItem value="MTG">Magic: The Gathering</SelectItem>
                  <SelectItem value="Pokemon">Pokémon TCG</SelectItem>
                  {gameTypes?.filter(g => !["Yu-Gi-Oh!", "MTG", "Pokemon"].includes(g)).map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Set Filter */}
            <div className="space-y-2">
              <Label>Set Filter (optional)</Label>
              <Select
                value={setFilter === "" ? "__all_sets__" : setFilter}
                onValueChange={(v) => setSetFilter(v === "__all_sets__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All sets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all_sets__">All Sets</SelectItem>
                  {availableSets?.slice(0, 50).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deck Size */}
            <div className="space-y-2">
              <Label>Deck Size</Label>
              <Input
                type="number"
                value={deckSize}
                onChange={(e) => setDeckSize(Number(e.target.value))}
                min={40}
                max={100}
              />
            </div>

            {/* Collection Only Toggle */}
            <div className="space-y-2">
              <Label>Source</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={useCollectionOnly}
                  onCheckedChange={setUseCollectionOnly}
                />
                <span className="text-sm">
                  {useCollectionOnly ? "Collection only" : "Include suggestions"}
                </span>
              </div>
            </div>
          </div>

          <Button 
            onClick={handleBuildDeck} 
            disabled={isBuilding}
            className="w-full h-12 text-lg"
            size="lg"
          >
            {isBuilding ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Building Deck...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Build {mode === "value" ? "Value" : "Battle"} Deck
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {deckResult && (
        <div className="space-y-6">
          {/* Deck Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl">{deckResult.deckName}</CardTitle>
                  <CardDescription className="mt-2">{deckResult.strategy}</CardDescription>
                </div>
                <Badge className={getRatingColor(deckResult.competitiveRating)}>
                  {deckResult.competitiveRating.toUpperCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-primary">
                    ${deckResult.totalValue.toFixed(2)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Value</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">
                    {deckResult.mainDeck.reduce((sum, c) => sum + c.quantity, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Main Deck</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">
                    {deckResult.extraDeck?.reduce((sum, c) => sum + c.quantity, 0) || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">Extra Deck</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-green-500">
                    {deckResult.mainDeck.filter(c => c.inCollection).length}
                  </div>
                  <div className="text-sm text-muted-foreground">Owned Cards</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Deck Lists */}
          <Tabs defaultValue="main" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="main">Main Deck</TabsTrigger>
              <TabsTrigger value="extra">Extra Deck</TabsTrigger>
              <TabsTrigger value="acquire">To Acquire</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
            </TabsList>

            <TabsContent value="main">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Main Deck ({deckResult.mainDeck.reduce((sum, c) => sum + c.quantity, 0)} cards)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {deckResult.mainDeck.map((card, idx) => (
                        <div 
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {card.imageUrl ? (
                              <img 
                                src={card.imageUrl} 
                                alt={card.cardName}
                                className="w-10 h-14 object-cover rounded"
                              />
                            ) : (
                              <div className="w-10 h-14 bg-muted rounded flex items-center justify-center">
                                <Layers className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div>
                              <div className="font-medium">{card.cardName}</div>
                              <div className="text-sm text-muted-foreground">{card.role}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <Badge variant={card.inCollection ? "default" : "secondary"}>
                              {card.inCollection ? "Owned" : "Need"}
                            </Badge>
                            <div className="text-right">
                              <div className="font-medium">x{card.quantity}</div>
                              <div className="text-sm text-muted-foreground">
                                ${(card.estimatedPrice * card.quantity).toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="extra">
              <Card>
                <CardHeader>
                  <CardTitle>Extra Deck</CardTitle>
                </CardHeader>
                <CardContent>
                  {deckResult.extraDeck && deckResult.extraDeck.length > 0 ? (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {deckResult.extraDeck.map((card, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                          >
                            <div>
                              <div className="font-medium">{card.cardName}</div>
                              <div className="text-sm text-muted-foreground">{card.role}</div>
                            </div>
                            <div className="flex items-center gap-4">
                              <Badge variant={card.inCollection ? "default" : "secondary"}>
                                {card.inCollection ? "Owned" : "Need"}
                              </Badge>
                              <div className="text-right">
                                <div className="font-medium">x{card.quantity}</div>
                                <div className="text-sm text-muted-foreground">
                                  ${card.estimatedPrice.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      No extra deck for this game type
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="acquire">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Cards to Acquire
                  </CardTitle>
                  <CardDescription>
                    Suggested cards to complete or improve your deck
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {deckResult.cardsToAcquire && deckResult.cardsToAcquire.length > 0 ? (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {deckResult.cardsToAcquire.map((card, idx) => (
                          <div 
                            key={idx}
                            className="p-4 rounded-lg border bg-card"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-medium">{card.cardName}</div>
                                <div className="text-sm text-muted-foreground mt-1">
                                  {card.reason}
                                </div>
                              </div>
                              <div className="text-right">
                                <Badge variant={getPriorityColor(card.priority) as any}>
                                  {card.priority}
                                </Badge>
                                <div className="text-lg font-bold mt-2">
                                  ${card.estimatedPrice.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      No acquisition suggestions - your collection has everything!
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analysis">
              <div className="grid md:grid-cols-2 gap-4">
                {/* Value Potential */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-500" />
                      Value Potential
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{deckResult.valuePotential}</p>
                  </CardContent>
                </Card>

                {/* Synergies */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Key Synergies
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {deckResult.synergies.map((synergy, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-primary">•</span>
                          <span className="text-sm">{synergy}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Weaknesses */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      Weaknesses to Consider
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid md:grid-cols-2 gap-2">
                      {deckResult.weaknesses.map((weakness, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-yellow-500">⚠</span>
                          <span className="text-sm">{weakness}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Empty State */}
      {!deckResult && !isBuilding && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wand2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No Deck Built Yet</h3>
            <p className="text-muted-foreground text-center max-w-md mt-2">
              Configure your preferences above and click "Build Deck" to let AI create 
              the optimal deck from your collection.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
