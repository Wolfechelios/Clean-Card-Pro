import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Search, Trash2, RefreshCw, Edit3, ImageOff, X, Download, ImagePlus, Cloud, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import AdvancedFilters, { FilterConfig } from "@/components/collections/AdvancedFilters";
import { CardThumbnail } from "@/components/collections/CardThumbnail";
import { VirtualizedCardGrid } from "@/components/collections/VirtualizedCardGrid";
import { CardDetailModal, CardData } from "@/components/cards/CardDetailModal";
import { BulkImageSearch } from "@/components/collections/BulkImageSearch";
import { AutopilotPanel } from "@/components/AutopilotPanel";
import { toPublicImageUrl } from "@/lib/storage/getPublicImageUrl";

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
  game_type: string | null;
  sport_type: string | null;
  psa10_price?: number | null;
  cgc10_price?: number | null;
  psa10_viable?: boolean | null;
  psa10_viable_confidence?: number | null;
  quantity?: number | null;
  last_price_update?: string | null;
}

export default function Collections() {
  const { userId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [recentTimeRange, setRecentTimeRange] = useState(2); // hours
  const [showDeleteNoImage, setShowDeleteNoImage] = useState(false);
  const [noImageCount, setNoImageCount] = useState(0);
  const [placeholderCount, setPlaceholderCount] = useState(0);
  const [externalImageCount, setExternalImageCount] = useState(0);
  const [isStoringImages, setIsStoringImages] = useState(false);
  const [isLookingUpImages, setIsLookingUpImages] = useState(false);
  const [imageLookupProgress, setImageLookupProgress] = useState({ processed: 0, total: 0, found: 0 });
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkImageSearch, setShowBulkImageSearch] = useState(false);
  const [cardDetail, setCardDetail] = useState<CardData | null>(null);
  const [showCardDetail, setShowCardDetail] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({
    condition: "",
    rarity: "",
    card_set: "",
    collection_name: "",
  });

  const availableSets = Array.from(new Set(cards.map(c => c.card_set).filter(Boolean))) as string[];
  const availableRarities = Array.from(new Set(cards.map(c => c.rarity).filter(Boolean))) as string[];
  const availableConditions = Array.from(new Set(cards.map(c => c.condition).filter(Boolean))) as string[];
  const availableGameTypes = Array.from(new Set(cards.map(c => c.game_type).filter(Boolean))) as string[];
  const availableSportTypes = Array.from(new Set(cards.map(c => c.sport_type).filter(Boolean))) as string[];
  const availableCollections = Array.from(new Set(cards.map(c => c.collection_name).filter(Boolean))) as string[];

  // Read filters from URL on mount only
  useEffect(() => {
    const rarityParam = searchParams.get("rarity");
    if (rarityParam) {
      setActiveFilters(prev => ({ ...prev, rarity: [rarityParam] }));
    }
    
    const psa10viableParam = searchParams.get("psa10viable");
    if (psa10viableParam === "true") {
      setActiveFilters(prev => ({ ...prev, psa10Viable: true }));
    }
    
    const anomalyParam = searchParams.get("anomaly");
    if (anomalyParam === "true") {
      setActiveFilters(prev => ({ ...prev, priceAnomaly: true }));
    }
    // Only run on initial mount, not on every searchParams change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear rarity filter from URL when filters change
  const clearRarityFilter = () => {
    setActiveFilters(prev => {
      const { rarity, ...rest } = prev;
      return rest;
    });
    searchParams.delete("rarity");
    setSearchParams(searchParams);
  };

  useEffect(() => {
    if (!userId) return;
    
    fetchCards();
    checkRecentImports();
    checkNoImageCards();
    checkPlaceholderCards();
    checkExternalImages();

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
          checkNoImageCards();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (userId) checkRecentImports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentTimeRange]);

  useEffect(() => {
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, cards, activeFilters]);

  const applyFilters = () => {
    let filtered = [...cards];

    // Text search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(card => 
        card.card_name.toLowerCase().includes(query) ||
        card.card_set?.toLowerCase().includes(query) ||
        card.card_number?.toLowerCase().includes(query)
      );
    }

    // Price filters
    if (activeFilters.priceMin !== undefined) {
      filtered = filtered.filter(card => (card.current_price_raw || 0) >= activeFilters.priceMin!);
    }
    if (activeFilters.priceMax !== undefined) {
      filtered = filtered.filter(card => (card.current_price_raw || 0) <= activeFilters.priceMax!);
    }

    // Array filters
    if (activeFilters.rarity?.length) {
      filtered = filtered.filter(card => card.rarity && activeFilters.rarity!.includes(card.rarity));
    }
    if (activeFilters.condition?.length) {
      filtered = filtered.filter(card => card.condition && activeFilters.condition!.includes(card.condition));
    }
    if (activeFilters.cardSet?.length) {
      filtered = filtered.filter(card => card.card_set && activeFilters.cardSet!.includes(card.card_set));
    }
    if (activeFilters.gameType?.length) {
      filtered = filtered.filter(card => card.game_type && activeFilters.gameType!.includes(card.game_type));
    }
    if (activeFilters.sportType?.length) {
      filtered = filtered.filter(card => card.sport_type && activeFilters.sportType!.includes(card.sport_type));
    }

    // Collection name filter
    if (activeFilters.collectionName) {
      filtered = filtered.filter(card => card.collection_name === activeFilters.collectionName);
    }

    // Price anomaly filter
    if (activeFilters.priceAnomaly) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      filtered = filtered.filter(card => {
        // No price
        if (!card.current_price_raw || card.current_price_raw === 0) return true;
        // Suspiciously high with no PSA10 backing
        if (card.current_price_raw > 500 && !card.psa10_price) return true;
        // PSA10 cheaper than raw (impossible)
        if (card.psa10_price && card.current_price_raw && card.psa10_price < card.current_price_raw) return true;
        // Common rarity priced high
        if (card.rarity && ['Common', 'common'].includes(card.rarity) && card.current_price_raw > 50) return true;
        // Stale price
        if (!card.last_price_update || new Date(card.last_price_update) < thirtyDaysAgo) return true;
        return false;
      });
    }

    // PSA 10 Viable filter
    if (activeFilters.psa10Viable === true) {
      filtered = filtered.filter(card => card.psa10_viable === true);
    } else if (activeFilters.psa10Viable === false) {
      filtered = filtered.filter(card => card.psa10_viable === false);
    }

    // Date filters
    if (activeFilters.dateFrom) {
      const fromDate = new Date(activeFilters.dateFrom);
      filtered = filtered.filter(card => new Date(card.created_at) >= fromDate);
    }
    if (activeFilters.dateTo) {
      const toDate = new Date(activeFilters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(card => new Date(card.created_at) <= toDate);
    }

    // Sorting
    const sortBy = activeFilters.sortBy || 'created_at';
    const sortOrder = activeFilters.sortOrder || 'desc';
    
    filtered.sort((a, b) => {
      let aVal: any = a[sortBy as keyof CardItem];
      let bVal: any = b[sortBy as keyof CardItem];
      
      // Handle nulls
      if (aVal === null) aVal = sortBy === 'current_price_raw' ? -Infinity : '';
      if (bVal === null) bVal = sortBy === 'current_price_raw' ? -Infinity : '';
      
      // Compare
      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'asc' ? cmp : -cmp;
      } else {
        const cmp = aVal - bVal;
        return sortOrder === 'asc' ? cmp : -cmp;
      }
    });

    setFilteredCards(filtered);
  };

  const fetchCards = async () => {
    if (!userId) return;
    
    try {
      // Fetch all cards using pagination to handle 1000+ card collections
      const allCards: CardItem[] = [];
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          // Convert expired signed URLs to public URLs
          const fixed = data.map(card => ({
            ...card,
            image_url: toPublicImageUrl(card.image_url),
            thumbnail_url: card.thumbnail_url ? toPublicImageUrl(card.thumbnail_url) : card.thumbnail_url,
          }));
          allCards.push(...fixed);
          page++;
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      setCards(allCards);
      setFilteredCards(allCards);
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
    if (!userId) return;
    
    try {
      const cutoff = new Date(Date.now() - recentTimeRange * 60 * 60 * 1000).toISOString();
      
      const { data: recentCards, error: fetchError } = await supabase
        .from("cards")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", cutoff);

      if (fetchError) throw fetchError;

      if (!recentCards || recentCards.length === 0) {
        toast.error(`No recent imports found (last ${recentTimeRange}h)`);
        setShowDeleteRecent(false);
        return;
      }

      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .gte("created_at", cutoff);

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
    if (!userId) return;
    
    try {
      const cutoff = new Date(Date.now() - recentTimeRange * 60 * 60 * 1000).toISOString();
      
      const { count, error } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .gte("created_at", cutoff);

      if (!error && count !== null) {
        setRecentImportCount(count);
      }
    } catch (error) {
      console.error("Error checking recent imports:", error);
    }
  };

  const checkNoImageCards = async () => {
    if (!userId) return;
    
    try {
      const { count, error } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .or("image_url.is.null,image_url.eq.");

      if (!error && count !== null) {
        setNoImageCount(count);
      }
    } catch (error) {
      console.error("Error checking no-image cards:", error);
    }
  };

  const checkPlaceholderCards = async () => {
    if (!userId) return;
    
    try {
      const { count, error } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .like("image_url", "%placehold%");

      if (!error && count !== null) {
        setPlaceholderCount(count);
      }
    } catch (error) {
      console.error("Error checking placeholder cards:", error);
    }
  };

  const checkExternalImages = async () => {
    if (!userId) return;
    
    try {
      // Get all cards with image URLs
      const { data: allCards, error } = await supabase
        .from("cards")
        .select("image_url")
        .eq("user_id", userId)
        .eq("image_locked", false)
        .not("image_url", "is", null)
        .not("image_url", "ilike", "%placehold%");

      if (error) throw error;

      // Count external URLs (not from our Supabase storage)
      const externalCards = (allCards || []).filter(card => {
        const url = card.image_url || "";
        return url && !url.includes("supabase") && !url.includes("cyyaapagcftbhafhlofb");
      });
      setExternalImageCount(externalCards.length);
    } catch (error) {
      console.error("Error checking external images:", error);
    }
  };

  const handleStoreExternalImages = async () => {
    if (!userId || externalImageCount === 0) return;

    setIsStoringImages(true);
    try {
      const { data, error } = await supabase.functions.invoke("refresh-external-images", {
        body: { limit: 25 },
      });

      if (error) throw error;

      if (data.success > 0) {
        toast.success(`Stored ${data.success} images to cloud storage`);
        fetchCards();
        checkExternalImages();
      } else if (data.processed === 0) {
        toast.info("No external images to store");
      } else {
        toast.warning(`Failed to store ${data.failed} images`);
      }
    } catch (error: any) {
      console.error("Store external images error:", error);
      toast.error("Failed to store external images");
    } finally {
      setIsStoringImages(false);
    }
  };

  const handleBulkImageLookup = async () => {
    if (!userId || placeholderCount === 0) {
      toast.info("No cards with placeholder images to process");
      return;
    }

    setIsLookingUpImages(true);
    setImageLookupProgress({ processed: 0, total: 0, found: 0 });

    try {
      const { data: cards, error } = await supabase
        .from("cards")
        .select("id, card_name, card_set, game_type, sport_type")
        .eq("user_id", userId)
        .like("image_url", "%placehold%");

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.info("No cards with placeholder images found");
        setIsLookingUpImages(false);
        return;
      }

      setImageLookupProgress({ processed: 0, total: cards.length, found: 0 });

      let updated = 0;
      let processed = 0;
      const batchSize = 10;

      for (let i = 0; i < cards.length; i += batchSize) {
        const batch = cards.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(async (card) => {
            try {
              const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
                body: {
                  cardName: card.card_name,
                  cardSet: card.card_set,
                  gameType: card.game_type || card.sport_type,
                },
              });

              if (error) throw error;

              if (data?.found && data?.imageUrl && !data.imageUrl.includes("placehold")) {
                const { error: updateError } = await supabase
                  .from("cards")
                  .update({ 
                    image_url: data.imageUrl,
                    updated_at: new Date().toISOString() 
                  })
                  .eq("id", card.id);

                if (!updateError) return true;
              }
              return false;
            } catch {
              return false;
            }
          })
        );

        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            updated++;
          }
        });

        processed += batch.length;
        setImageLookupProgress({ processed, total: cards.length, found: updated });

        if (i + batchSize < cards.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      toast.success(`Found images for ${updated} of ${cards.length} cards`);
      fetchCards();
      checkPlaceholderCards();
    } catch (error: any) {
      console.error("Bulk image lookup error:", error);
      toast.error(error.message || "Error during image lookup");
    } finally {
      setIsLookingUpImages(false);
    }
  };

  const handleDeleteNoImage = async () => {
    if (!userId) return;
    
    try {
      const { data: noImageCards, error: fetchError } = await supabase
        .from("cards")
        .select("id")
        .eq("user_id", userId)
        .or("image_url.is.null,image_url.eq.");

      if (fetchError) throw fetchError;

      if (!noImageCards || noImageCards.length === 0) {
        toast.error("No cards without images found");
        setShowDeleteNoImage(false);
        return;
      }

      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .or("image_url.is.null,image_url.eq.");

      if (error) throw error;

      toast.success(`Deleted ${noImageCards.length} card(s) without images`);
      fetchCards();
    } catch (error) {
      console.error("Error deleting no-image cards:", error);
      toast.error("Failed to delete no-image cards");
    } finally {
      setShowDeleteNoImage(false);
    }
  };

  const handleBulkEdit = async () => {
    if (selectedCards.size === 0) return;

    try {
      const updates: any = {};
      if (bulkEditData.condition) updates.condition = bulkEditData.condition;
      if (bulkEditData.rarity) updates.rarity = bulkEditData.rarity;
      if (bulkEditData.card_set) updates.card_set = bulkEditData.card_set;
      if (bulkEditData.collection_name) updates.collection_name = bulkEditData.collection_name;

      if (Object.keys(updates).length === 0) {
        toast.error("Please select at least one field to update");
        return;
      }

      const { error } = await supabase
        .from("cards")
        .update(updates)
        .in("id", Array.from(selectedCards));

      if (error) throw error;

      toast.success(`Updated ${selectedCards.size} card(s) successfully`);
      fetchCards();
      setShowBulkEdit(false);
      setBulkEditData({
        condition: "",
        rarity: "",
        card_set: "",
        collection_name: "",
      });
      setSelectedCards(new Set());
    } catch (error) {
      console.error("Error updating cards:", error);
      toast.error("Failed to update cards");
    }
  };

  const handleUpdatePrices = async () => {
    if (!userId) {
      toast.error("You must be logged in to update prices");
      return;
    }
    
    try {
      setIsUpdatingPrices(true);
      toast.loading("Updating prices...", { id: "price-update" });

      const { data, error } = await supabase.functions.invoke("update-prices", {
        body: { user_id: userId },
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
      <AutopilotPanel cards={cards} />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
          {[...Array(24)].map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AutopilotPanel cards={cards} />
      <div>
        <h1 className="text-3xl font-bold text-foreground">My Collections</h1>
        <p className="text-muted-foreground">Browse and manage your card collection</p>
      </div>

      {/* Active rarity filter banner */}
      {activeFilters.rarity?.length === 1 && searchParams.get("rarity") && (
        <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-sm">Showing cards with rarity:</span>
          <Badge variant="secondary" className="text-sm">
            {activeFilters.rarity[0]}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearRarityFilter}
            className="ml-auto"
          >
            <X className="h-4 w-4 mr-1" />
            Clear Filter
          </Button>
        </div>
      )}

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
            <div className="flex items-center gap-1">
              <select
                value={recentTimeRange}
                onChange={(e) => setRecentTimeRange(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-card text-sm px-2"
              >
                <option value={2}>2h</option>
                <option value={4}>4h</option>
                <option value={6}>6h</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteRecent(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Recent Import ({recentImportCount})
              </Button>
            </div>
          )}

          {noImageCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteNoImage(true)}
            >
              <ImageOff className="h-4 w-4 mr-2" />
              Delete No-Image ({noImageCount})
            </Button>
          )}

          {placeholderCount > 0 && !isLookingUpImages && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkImageLookup}
              disabled={isLookingUpImages}
            >
              <Download className="h-4 w-4 mr-2" />
              Find Images ({placeholderCount})
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulkImageSearch(true)}
          >
            <ImagePlus className="h-4 w-4 mr-2" />
            Find Missing Images
          </Button>

          {externalImageCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStoreExternalImages}
              disabled={isStoringImages}
            >
              <Cloud className={`h-4 w-4 mr-2 ${isStoringImages ? 'animate-pulse' : ''}`} />
              Store External ({externalImageCount})
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

          <Button
            variant={activeFilters.psa10Viable === true ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (activeFilters.psa10Viable === true) {
                setActiveFilters(prev => ({ ...prev, psa10Viable: undefined }));
              } else {
                setActiveFilters(prev => ({ ...prev, psa10Viable: true }));
              }
            }}
          >
            <Gem className="h-4 w-4 mr-2" />
            PSA 10 Viable ({cards.filter(c => c.psa10_viable === true).length})
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
                variant="outline" 
                size="sm"
                onClick={() => setShowBulkEdit(true)}
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Edit Selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const first = filteredCards.find((c) => selectedCards.has(c.id));
                  if (first) {
                    setCardDetail(first as any);
                    setShowCardDetail(true);
                    toast.info("Tap 'Verify Match' inside the card details to verify.");
                  }
                }}
                title="Verify selected card identity & price"
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Verify Selected
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

      {/* Advanced Filters */}
      <AdvancedFilters
        onFilterChange={setActiveFilters}
        availableSets={availableSets}
        availableRarities={availableRarities}
        availableConditions={availableConditions}
        availableGameTypes={availableGameTypes}
        availableSportTypes={availableSportTypes}
        availableCollections={availableCollections}
        initialFilters={activeFilters}
      />

      {/* Image Lookup Progress */}
      {isLookingUpImages && imageLookupProgress.total > 0 && (
        <Card className="bg-card border-primary/30">
          <CardContent className="py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Looking up card images...</span>
                <span className="text-muted-foreground">
                  {imageLookupProgress.processed} / {imageLookupProgress.total}
                </span>
              </div>
              <Progress 
                value={(imageLookupProgress.processed / imageLookupProgress.total) * 100} 
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{Math.round((imageLookupProgress.processed / imageLookupProgress.total) * 100)}% complete</span>
                <span className="text-success">{imageLookupProgress.found} images found</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Results count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {filteredCards.reduce((sum, c) => sum + (c.quantity || 1), 0)} of {cards.reduce((sum, c) => sum + (c.quantity || 1), 0)} cards
          {Object.keys(activeFilters).filter(k => k !== 'sortBy' && k !== 'sortOrder').length > 0 && ' (filtered)'}
        </span>
        {filteredCards.length > 0 && (
          <span className="font-medium text-foreground">
            Total Value: ${filteredCards.reduce((sum, c) => sum + (c.current_price_raw || 0) * (c.quantity || 1), 0).toFixed(2)}
          </span>
        )}
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
        <VirtualizedCardGrid
          cards={filteredCards}
          selectedCards={selectedCards}
          onSelect={toggleCardSelection}
          onDelete={setCardToDelete}
          onCardClick={(card) => {
            setCardDetail(card);
            setShowCardDetail(true);
          }}
          onRefresh={() => {
            fetchCards();
            checkPlaceholderCards();
          }}
        />
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
              Are you sure you want to delete {recentImportCount} card(s) imported in the last {recentTimeRange} hours? This action cannot be undone.
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

      <AlertDialog open={showDeleteNoImage} onOpenChange={setShowDeleteNoImage}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cards Without Images</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {noImageCount} card(s) that have no images? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteNoImage} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showBulkEdit} onOpenChange={setShowBulkEdit}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit {selectedCards.size} Card(s)</DialogTitle>
            <DialogDescription>
              Update information for {selectedCards.size} selected card(s). Leave fields empty to keep current values.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="condition">Condition</Label>
              <Select
                value={bulkEditData.condition}
                onValueChange={(value) => setBulkEditData({ ...bulkEditData, condition: value })}
              >
                <SelectTrigger id="condition">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mint">Mint</SelectItem>
                  <SelectItem value="Near Mint">Near Mint</SelectItem>
                  <SelectItem value="Excellent">Excellent</SelectItem>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Light Play">Light Play</SelectItem>
                  <SelectItem value="Played">Played</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rarity">Rarity</Label>
              <Input
                id="rarity"
                placeholder="e.g., Common, Rare, Ultra Rare"
                value={bulkEditData.rarity}
                onChange={(e) => setBulkEditData({ ...bulkEditData, rarity: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="card_set">Card Set</Label>
              <Input
                id="card_set"
                placeholder="e.g., Base Set, Jungle"
                value={bulkEditData.card_set}
                onChange={(e) => setBulkEditData({ ...bulkEditData, card_set: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="collection_name">Collection Name</Label>
              <Input
                id="collection_name"
                placeholder="e.g., My Collection"
                value={bulkEditData.collection_name}
                onChange={(e) => setBulkEditData({ ...bulkEditData, collection_name: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkEdit}>
              Update {selectedCards.size} Card(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card Detail Modal with Edit/Delete */}
      <CardDetailModal
        card={cardDetail}
        open={showCardDetail}
        onOpenChange={setShowCardDetail}
        onUpdate={(updatedCard) => {
          setCards(cards.map(c => c.id === updatedCard.id ? { ...c, ...updatedCard } : c));
          setCardDetail(updatedCard);
        }}
        onDelete={(cardId) => {
          setCards(cards.filter(c => c.id !== cardId));
          setFilteredCards(filteredCards.filter(c => c.id !== cardId));
        }}
      />

      {/* Bulk Image Search Dialog */}
      <Dialog open={showBulkImageSearch} onOpenChange={setShowBulkImageSearch}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Find Missing Images</DialogTitle>
            <DialogDescription>
              Search for card images from Scryfall, Pokemon TCG, YGOPRODeck, and eBay
            </DialogDescription>
          </DialogHeader>
          <BulkImageSearch
            onComplete={() => {
              fetchCards();
              checkPlaceholderCards();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

