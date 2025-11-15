import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Download, Trash2, DollarSign, TrendingUp } from "lucide-react";
import * as XLSX from "xlsx";

interface CollectionProps {
  userId: string;
}

interface CardData {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  condition: string;
  image_url: string;
  current_price_raw: number | null;
  current_price_psa9: number | null;
  current_price_psa10: number | null;
  ocr_confidence: number | null;
  collection_name: string | null;
  created_at: string;
}

const Collection = ({ userId }: CollectionProps) => {
  const [cards, setCards] = useState<CardData[]>([]);
  const [filteredCards, setFilteredCards] = useState<CardData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    fetchCards();
  }, [userId]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = cards.filter(
        (card) =>
          card.card_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.card_set?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.card_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredCards(filtered);
    } else {
      setFilteredCards(cards);
    }
  }, [searchQuery, cards]);

  useEffect(() => {
    const total = cards.reduce((sum, card) => {
      return sum + (card.current_price_raw || 0);
    }, 0);
    setTotalValue(total);
  }, [cards]);

  const fetchCards = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCards(data || []);
      setFilteredCards(data || []);
    } catch (error: any) {
      console.error("Error fetching cards:", error);
      toast.error("Failed to load collection");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (cardId: string) => {
    try {
      const { error } = await supabase.from("cards").delete().eq("id", cardId);

      if (error) throw error;

      toast.success("Card deleted");
      fetchCards();
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error("Failed to delete card");
    }
  };

  const handleExport = () => {
    const exportData = cards.map((card) => ({
      "Card Name": card.card_name,
      Set: card.card_set || "",
      Number: card.card_number || "",
      Rarity: card.rarity || "",
      Edition: card.edition || "",
      Condition: card.condition,
      "Raw Price": card.current_price_raw || 0,
      "PSA 9 Price": card.current_price_psa9 || 0,
      "PSA 10 Price": card.current_price_psa10 || 0,
      "OCR Confidence": card.ocr_confidence || 0,
      Collection: card.collection_name || "",
      "Scanned Date": new Date(card.created_at).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cards");
    XLSX.writeFile(wb, `card-collection-${Date.now()}.xlsx`);
    toast.success("Collection exported successfully");
  };

  if (isLoading) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex min-h-[400px] items-center justify-center">
          <p className="text-muted-foreground">Loading collection...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cards</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cards.length}</div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              ${totalValue.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Card Value</CardTitle>
            <DollarSign className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-accent">
              ${cards.length > 0 ? (totalValue / cards.length).toFixed(2) : "0.00"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collection Card */}
      <Card className="shadow-card">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>My Collection</CardTitle>
              <CardDescription>
                View and manage your scanned cards
              </CardDescription>
            </div>
            <Button onClick={handleExport} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search cards by name, set, or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Cards Grid */}
          {filteredCards.length === 0 ? (
            <div className="flex min-h-[300px] items-center justify-center text-center text-muted-foreground">
              <div className="space-y-2">
                <p>No cards found</p>
                {searchQuery ? (
                  <p className="text-sm">Try adjusting your search</p>
                ) : (
                  <p className="text-sm">Start scanning cards to build your collection</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredCards.map((card) => (
                <Card key={card.id} className="overflow-hidden shadow-card">
                  <div className="aspect-[3/4] overflow-hidden bg-muted">
                    <img
                      src={card.image_url}
                      alt={card.card_name}
                      className="h-full w-full object-cover transition-transform hover:scale-105"
                    />
                  </div>
                  <CardContent className="space-y-2 p-4">
                    <div>
                      <h3 className="font-semibold leading-tight">{card.card_name}</h3>
                      {card.card_set && (
                        <p className="text-sm text-muted-foreground">{card.card_set}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {card.card_number && (
                        <Badge variant="secondary" className="text-xs">
                          #{card.card_number}
                        </Badge>
                      )}
                      {card.condition && (
                        <Badge variant="outline" className="text-xs">
                          {card.condition}
                        </Badge>
                      )}
                    </div>

                    {card.current_price_raw && (
                      <div className="flex items-center gap-1 text-success">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-semibold">
                          {card.current_price_raw.toFixed(2)}
                        </span>
                      </div>
                    )}

                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => handleDelete(card.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Collection;
