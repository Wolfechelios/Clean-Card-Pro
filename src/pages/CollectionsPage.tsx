import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface CardItem {
  id: string;
  card_name: string;
  card_set: string | null;
  image_url: string;
  thumbnail_url: string | null;
  current_price_raw: number | null;
  collection_name: string | null;
  condition: string | null;
}

export default function Collections() {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [filteredCards, setFilteredCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchCards();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const filtered = cards.filter(card => 
        card.card_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.card_set?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredCards(filtered);
    } else {
      setFilteredCards(cards);
    }
  }, [searchQuery, cards]);

  const fetchCards = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCards(data || []);
      setFilteredCards(data || []);
    } catch (error) {
      console.error("Error fetching cards:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">My Collections</h1>
        <p className="text-muted-foreground">Browse and manage your card collection</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search cards..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-card border-border"
        />
      </div>

      {filteredCards.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground text-center">
              {searchQuery ? "No cards found matching your search" : "No cards in your collection yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCards.map((card) => (
            <Card key={card.id} className="bg-card border-border hover:shadow-lg transition-shadow overflow-hidden">
              <CardHeader className="p-0">
                <div className="aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={card.thumbnail_url || card.image_url}
                    alt={card.card_name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <CardTitle className="text-base font-semibold text-foreground truncate">
                  {card.card_name}
                </CardTitle>
                {card.card_set && (
                  <p className="text-sm text-muted-foreground mt-1">{card.card_set}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {card.collection_name && (
                    <Badge variant="secondary" className="text-xs">
                      {card.collection_name}
                    </Badge>
                  )}
                  {card.condition && (
                    <Badge variant="outline" className="text-xs">
                      {card.condition}
                    </Badge>
                  )}
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                {card.current_price_raw && (
                  <p className="text-lg font-bold text-foreground">
                    ${card.current_price_raw.toFixed(2)}
                  </p>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

