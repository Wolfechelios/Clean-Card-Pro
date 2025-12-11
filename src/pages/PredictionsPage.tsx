import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Search,
  DollarSign,
  Target,
  Zap,
  ArrowRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { ValuePrediction } from "@/components/cards/ValuePrediction";
import Card3DViewer from "@/components/Card3DViewer";
import { toast } from "sonner";
import { CardDetailModal, CardData } from "@/components/cards/CardDetailModal";

interface CardItem {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  game_type: string | null;
  sport_type: string | null;
  current_price_raw: number | null;
  current_price_psa9: number | null;
  current_price_psa10: number | null;
  image_url: string;
  suggested_price: number | null;
}

export default function PredictionsPage() {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardItem | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);

  useEffect(() => {
    fetchCards();
  }, []);

  const fetchCards = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch all cards using pagination
      const allCards: any[] = [];
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("user_id", user.id)
          .order("suggested_price", { ascending: false, nullsFirst: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allCards.push(...data);
          page++;
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      setCards(allCards);
    } catch (error) {
      console.error("Error fetching cards:", error);
      toast.error("Failed to load cards");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPriceHistory = async (cardId: string) => {
    try {
      const { data, error } = await supabase
        .from("price_history")
        .select("*")
        .eq("card_id", cardId)
        .order("recorded_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      setPriceHistory(data || []);
    } catch (error) {
      console.error("Error fetching price history:", error);
    }
  };

  const handleSelectCard = async (card: CardItem) => {
    setSelectedCard(card);
    await fetchPriceHistory(card.id);
  };

  const filteredCards = cards.filter(card =>
    card.card_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    card.card_set?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const topValueCards = cards.slice(0, 5);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600">
                <Brain className="h-6 w-6 text-white" />
              </div>
              AI Value Predictions
            </h1>
            <p className="text-muted-foreground mt-1">
              Revolutionary AI-powered future value forecasting for your collection
            </p>
          </div>
          <Badge className="bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0">
            <Sparkles className="h-3 w-3 mr-1" />
            Powered by AI
          </Badge>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 border-green-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{cards.length}</p>
                  <p className="text-xs text-muted-foreground">Cards to Analyze</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border-blue-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <DollarSign className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    ${cards.reduce((sum, c) => sum + (c.suggested_price || 0), 0).toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Collection Value</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border-purple-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Target className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">AI</p>
                  <p className="text-xs text-muted-foreground">Market Analysis</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 border-amber-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <Zap className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">Real-time</p>
                  <p className="text-xs text-muted-foreground">Predictions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Card Selection Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Select a Card</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search cards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2 pr-4">
                      {filteredCards.map((card) => (
                        <button
                          key={card.id}
                          onClick={() => handleSelectCard(card)}
                          className={`w-full p-3 rounded-lg border text-left transition-all ${
                            selectedCard?.id === card.id
                              ? "border-purple-500 bg-purple-500/10"
                              : "border-border hover:border-purple-500/50 hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={card.image_url}
                              alt={card.card_name}
                              className="w-12 h-16 object-cover rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{card.card_name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {card.card_set || "Unknown Set"}
                              </p>
                              <p className="text-sm font-semibold text-green-400">
                                ${card.suggested_price?.toFixed(2) || "N/A"}
                              </p>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </button>
                      ))}

                      {filteredCards.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No cards found</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Prediction Panel */}
          <div className="lg:col-span-2">
            {selectedCard ? (
              <div className="space-y-4">
                {/* Selected Card Preview */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-col lg:flex-row gap-6">
                      <div className="flex items-start gap-4 flex-1">
                        <img
                          src={selectedCard.image_url}
                          alt={selectedCard.card_name}
                          className="w-24 h-32 object-cover rounded-lg shadow-lg"
                        />
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h2 className="text-xl font-bold">{selectedCard.card_name}</h2>
                              <p className="text-muted-foreground">{selectedCard.card_set}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowCardDetailModal(true)}
                              >
                                <Pencil className="h-4 w-4 mr-1" />
                                Edit
                              </Button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {selectedCard.rarity && (
                              <Badge variant="secondary">{selectedCard.rarity}</Badge>
                            )}
                            {selectedCard.game_type && (
                              <Badge variant="outline">{selectedCard.game_type}</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-4 mt-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Raw</p>
                              <p className="font-semibold">
                                ${selectedCard.current_price_raw?.toFixed(2) || "N/A"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">PSA 9</p>
                              <p className="font-semibold">
                                ${selectedCard.current_price_psa9?.toFixed(2) || "N/A"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">PSA 10</p>
                              <p className="font-semibold">
                                ${selectedCard.current_price_psa10?.toFixed(2) || "N/A"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* 3D View */}
                      <div className="flex-shrink-0">
                        <p className="text-sm font-medium text-muted-foreground mb-2">3D View</p>
                        <Card3DViewer
                          frontImageUrl={selectedCard.image_url}
                          width={320}
                          height={240}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* AI Prediction */}
                <ValuePrediction card={selectedCard} priceHistory={priceHistory} />
              </div>
            ) : (
              <Card className="h-full min-h-[600px] flex items-center justify-center bg-gradient-to-br from-purple-900/10 to-blue-900/10 border-dashed border-2 border-purple-500/30">
                <CardContent className="text-center">
                  <div className="p-4 rounded-full bg-purple-500/20 w-fit mx-auto mb-4">
                    <Brain className="h-12 w-12 text-purple-400" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Select a Card to Analyze</h3>
                  <p className="text-muted-foreground max-w-md">
                    Choose a card from your collection to get AI-powered value predictions,
                    market analysis, and investment recommendations.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Top Value Cards Quick Access */}
        {topValueCards.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-400" />
                Top Value Cards
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {topValueCards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => handleSelectCard(card)}
                    className="flex-shrink-0 p-3 rounded-lg border border-border hover:border-purple-500/50 transition-colors"
                  >
                    <img
                      src={card.image_url}
                      alt={card.card_name}
                      className="w-16 h-22 object-cover rounded mb-2"
                    />
                    <p className="text-sm font-medium truncate max-w-[80px]">{card.card_name}</p>
                    <p className="text-xs text-green-400">${card.suggested_price?.toFixed(2)}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Card Detail Modal */}
      {selectedCard && (
        <CardDetailModal
          card={{
            id: selectedCard.id,
            card_name: selectedCard.card_name,
            card_set: selectedCard.card_set,
            card_number: selectedCard.card_number,
            rarity: selectedCard.rarity,
            image_url: selectedCard.image_url,
            current_price_raw: selectedCard.current_price_raw,
            collection_name: null,
            condition: null,
            game_type: selectedCard.game_type,
            sport_type: selectedCard.sport_type,
          }}
          open={showCardDetailModal}
          onOpenChange={setShowCardDetailModal}
          onUpdate={(updatedCard) => {
            setCards(cards.map(c => c.id === updatedCard.id ? { ...c, ...updatedCard } : c));
            setSelectedCard({ ...selectedCard, ...updatedCard });
          }}
          onDelete={(cardId) => {
            setCards(cards.filter(c => c.id !== cardId));
            setSelectedCard(null);
          }}
        />
      )}
    </div>
  );
}
