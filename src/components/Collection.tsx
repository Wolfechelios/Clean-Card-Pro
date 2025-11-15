import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Download, Trash2, DollarSign, TrendingUp, Grid3x3, List, CheckSquare, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [sortBy, setSortBy] = useState("date-desc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  useEffect(() => {
    fetchCards();
  }, [userId]);

  useEffect(() => {
    let filtered = cards;
    
    if (searchQuery.trim()) {
      filtered = cards.filter(
        (card) =>
          card.card_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.card_set?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.card_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.card_name.localeCompare(b.card_name);
        case "name-desc":
          return b.card_name.localeCompare(a.card_name);
        case "value-asc":
          return (a.current_price_raw || 0) - (b.current_price_raw || 0);
        case "value-desc":
          return (b.current_price_raw || 0) - (a.current_price_raw || 0);
        case "date-asc":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "date-desc":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    
    setFilteredCards(sorted);
  }, [searchQuery, cards, sortBy]);

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
  
  const toggleCardSelection = (cardId: string) => {
    const newSelected = new Set(selectedCards);
    if (newSelected.has(cardId)) {
      newSelected.delete(cardId);
    } else {
      newSelected.add(cardId);
    }
    setSelectedCards(newSelected);
  };
  
  const handleBulkDelete = async () => {
    if (selectedCards.size === 0) return;
    
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .in("id", Array.from(selectedCards));
      
      if (error) throw error;
      
      toast.success(`Deleted ${selectedCards.size} cards`);
      setSelectedCards(new Set());
      setBulkMode(false);
      fetchCards();
    } catch (error) {
      console.error("Bulk delete error:", error);
      toast.error("Failed to delete cards");
    }
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>My Collection</CardTitle>
              <CardDescription>
                {cards.length} cards • ${totalValue.toFixed(2)} total value
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Newest First</SelectItem>
                  <SelectItem value="date-asc">Oldest First</SelectItem>
                  <SelectItem value="name-asc">Name A-Z</SelectItem>
                  <SelectItem value="name-desc">Name Z-A</SelectItem>
                  <SelectItem value="value-desc">Highest Value</SelectItem>
                  <SelectItem value="value-asc">Lowest Value</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
                title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
              >
                {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid3x3 className="h-4 w-4" />}
              </Button>
              <Button
                variant={bulkMode ? "default" : "outline"}
                size="icon"
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setSelectedCards(new Set());
                }}
                title="Toggle bulk select mode"
              >
                <CheckSquare className="h-4 w-4" />
              </Button>
              <Button onClick={handleExport} variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, set, or number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {bulkMode && selectedCards.size > 0 && (
              <>
                <Button onClick={handleBulkDelete} variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete ({selectedCards.size})
                </Button>
                <Button onClick={() => setSelectedCards(new Set())} variant="outline" size="icon">
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
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
