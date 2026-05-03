import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";

interface SearchMatch {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  market_price: number | null;
}

interface CardManualSearchProps {
  gameType: string | null;
  onSelect: (match: SearchMatch) => void;
  defaultCardNumber?: string | null;
  defaultSetCode?: string | null;
  defaultSetName?: string | null;
}

export function CardManualSearch({ gameType, onSelect }: CardManualSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);

    try {
      const { data, error } = await supabase.functions.invoke("search-card-details", {
        body: { card_name: searchQuery.trim(), game_type: gameType || "yugioh" },
      });

      if (error) {
        console.error("Search error:", error);
        return;
      }

      setSearchResults(data?.matches || []);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors">
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="h-4 w-4" />
              None of these? Search manually
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Type card name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()} size="sm">
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {searchResults.map((match, i) => (
                  <button
                    key={i}
                    onClick={() => onSelect(match)}
                    className="w-full p-3 rounded-lg border hover:border-primary hover:bg-accent transition-colors text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{match.card_name}</div>
                        {match.card_set && (
                          <div className="text-sm text-muted-foreground truncate">{match.card_set}</div>
                        )}
                        {match.card_number && (
                          <div className="text-xs text-muted-foreground">#{match.card_number}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {match.rarity && <Badge variant="outline" className="text-xs">{match.rarity}</Badge>}
                        {match.market_price != null && match.market_price > 0 && (
                          <span className="text-xs text-primary font-medium">${match.market_price.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {isSearching && (
              <div className="text-sm text-muted-foreground text-center py-2">Searching...</div>
            )}

            {!isSearching && searchResults.length === 0 && searchQuery.trim() && (
              <div className="text-sm text-muted-foreground text-center py-2">
                No results yet. Press search or Enter.
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
