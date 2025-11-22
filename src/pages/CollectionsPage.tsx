import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Trash2, TrendingUp, DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import AdvancedFilters, { FilterConfig } from "@/components/collections/AdvancedFilters";
import ImportExport from "@/components/collections/ImportExport";
import PriceAlerts from "@/components/collections/PriceAlerts";
import PortfolioView from "@/components/collections/PortfolioView";

interface CardItem {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  image_url: string;
  thumbnail_url: string | null;
  current_price_raw: number | null;
  collection_name: string | null;
  condition: string | null;
  created_at: string;
}

export default function Collections() {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [filteredCards, setFilteredCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [cardToDelete, setCardToDelete] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterConfig>({});
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [showDeleteRecent, setShowDeleteRecent] = useState(false);
  const [recentImportCount, setRecentImportCount] = useState(0);

  const availableSets = Array.from(new Set(cards.map(c => c.card_set).filter(Boolean))) as string[];
  const availableRarities = Array.from(new Set(cards.map(c => c.rarity).filter(Boolean))) as string[];

  useEffect(() => {
    fetchCards();
    checkRecentImports();

    // Set up real-time subscription for card changes
    const channel = supabase
      .channel('cards-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cards'
        },
        (payload) => {
          console.log('Card change detected:', payload);
          // Refresh the cards list on any change
          fetchCards();
          checkRecentImports();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    applyFilters();
  }, [searchQuery, cards, activeFilters]);

  const applyFilters = () => {
    let filtered = [...cards];

    if (searchQuery) {
      filtered = filtered.filter(card => 
        card.card_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.card_set?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (activeFilters.priceMin !== undefined) {
      filtered = filtered.filter(card => (card.current_price_raw || 0) >= activeFilters.priceMin!);
    }
    if (activeFilters.priceMax !== undefined) {
      filtered = filtered.filter(card => (card.current_price_raw || 0) <= activeFilters.priceMax!);
    }
    if (activeFilters.rarity?.length) {
      filtered = filtered.filter(card => card.rarity && activeFilters.rarity!.includes(card.rarity));
    }
    if (activeFilters.condition?.length) {
      filtered = filtered.filter(card => card.condition && activeFilters.condition!.includes(card.condition));
    }
    if (activeFilters.cardSet?.length) {
      filtered = filtered.filter(card => card.card_set && activeFilters.cardSet!.includes(card.card_set));
    }

    setFilteredCards(filtered);
  };

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

  const handleDelete = async () => {
    if (!cardToDelete) return;

    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("id", cardToDelete);

      if (error) throw error;

      setCards(cards.filter(card => card.id !== cardToDelete));
      setFilteredCards(filteredCards.filter(card => card.id !== cardToDelete));
      toast.success("Card deleted successfully");
    } catch (error) {
      console.error("Error deleting card:", error);
      toast.error("Failed to delete card");
    } finally {
      setCardToDelete(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCards.size === 0) return;

    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .in("id", Array.from(selectedCards));

      if (error) throw error;

      setCards(cards.filter(card => !selectedCards.has(card.id)));
      setFilteredCards(filteredCards.filter(card => !selectedCards.has(card.id)));
      toast.success(`${selectedCards.size} card(s) deleted successfully`);
      setSelectedCards(new Set());
    } catch (error) {
      console.error("Error deleting cards:", error);
      toast.error("Failed to delete cards");
    } finally {
      setShowBulkDelete(false);
    }
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

  const selectAll = () => {
    setSelectedCards(new Set(filteredCards.map(card => card.id)));
  };

  const deselectAll = () => {
    setSelectedCards(new Set());
  };

  const handleDeleteRecentImport = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get cards created in the last 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data: recentCards, error: fetchError } = await supabase
        .from("cards")
        .select("id")
        .eq("user_id", session.user.id)
        .gte("created_at", fiveMinutesAgo);

      if (fetchError) throw fetchError;

      if (!recentCards || recentCards.length === 0) {
        toast.error("No recent imports found (last 5 minutes)");
        setShowDeleteRecent(false);
        return;
      }

      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", session.user.id)
        .gte("created_at", fiveMinutesAgo);

      if (error) throw error;

      toast.success(`Deleted ${recentCards.length} recently imported card(s)`);
      fetchCards();
    } catch (error) {
      console.error("Error deleting recent imports:", error);
      toast.error("Failed to delete recent imports");
    } finally {
      setShowDeleteRecent(false);
    }
  };

  const checkRecentImports = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { count, error } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", session.user.id)
        .gte("created_at", fiveMinutesAgo);

      if (!error && count !== null) {
        setRecentImportCount(count);
      }
    } catch (error) {
      console.error("Error checking recent imports:", error);
    }
  };

  const handleUpdatePrices = async () => {
    try {
      setIsUpdatingPrices(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to update prices");
        return;
      }

      toast.loading("Updating prices...", { id: "price-update" });

      const { data, error } = await supabase.functions.invoke("update-prices", {
        body: { user_id: session.user.id },
      });

      if (error) throw error;

      toast.success(
        `Price update complete! Updated ${data.updated} of ${data.total_checked} cards`,
        { id: "price-update" }
      );
      
      // Refresh cards to show new prices
      fetchCards();
    } catch (error) {
      console.error("Error updating prices:", error);
      toast.error("Failed to update prices", { id: "price-update" });
    } finally {
      setIsUpdatingPrices(false);
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

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-card border-border"
          />
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {recentImportCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteRecent(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Recent Import ({recentImportCount})
            </Button>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpdatePrices}
            disabled={isUpdatingPrices || cards.length === 0}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isUpdatingPrices ? 'animate-spin' : ''}`} />
            Update Prices
          </Button>
          
          {selectedCards.size > 0 ? (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedCards.size} selected
              </span>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
              <Button 
                variant="destructive" 
                size="sm"
                onClick={() => setShowBulkDelete(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected
              </Button>
            </>
          ) : (
            filteredCards.length > 0 && (
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
            )
          )}
        </div>
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
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredCards.map((card, index) => (
            <Card 
              key={card.id} 
              className="bg-card border-border hover:shadow-xl hover:scale-105 transition-all duration-300 overflow-hidden group relative animate-in fade-in slide-in-from-bottom-4"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="absolute top-2 left-2 z-10 transition-transform duration-200 hover:scale-110">
                <Checkbox
                  checked={selectedCards.has(card.id)}
                  onCheckedChange={() => toggleCardSelection(card.id)}
                  className="bg-background border-2 shadow-lg"
                />
              </div>
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 shadow-lg"
                onClick={() => setCardToDelete(card.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <CardHeader className="p-0">
                <div className="aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={card.thumbnail_url || card.image_url}
                    alt={card.card_name}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                <CardTitle className="text-sm sm:text-base font-semibold text-foreground truncate">
                  {card.card_name}
                </CardTitle>
                {card.card_set && (
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1 truncate">{card.card_set}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
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
              <CardFooter className="p-3 sm:p-4 pt-0">
                {card.current_price_raw && (
                  <p className="text-base sm:text-lg font-bold text-foreground">
                    ${card.current_price_raw.toFixed(2)}
                  </p>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!cardToDelete} onOpenChange={(open) => !open && setCardToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this card? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCards.size} Card(s)</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCards.size} selected card(s)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete {selectedCards.size} Card(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteRecent} onOpenChange={setShowDeleteRecent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recent Import</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {recentImportCount} card(s) imported in the last 5 minutes? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRecentImport} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Recent Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

