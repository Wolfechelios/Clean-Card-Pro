import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter, Save, Trash2, ChevronDown, ChevronUp, SortAsc, SortDesc } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface FilterConfig {
  priceMin?: number;
  priceMax?: number;
  rarity?: string[];
  condition?: string[];
  cardSet?: string[];
  gameType?: string[];
  sportType?: string[];
  dateFrom?: string;
  dateTo?: string;
  collectionName?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  psa10Viable?: boolean | null; // null = all, true = viable, false = not viable
}

interface AdvancedFiltersProps {
  onFilterChange: (filters: FilterConfig) => void;
  availableSets: string[];
  availableRarities: string[];
  availableGameTypes?: string[];
  availableSportTypes?: string[];
  availableConditions?: string[];
  availableCollections?: string[];
  initialFilters?: FilterConfig;
}

const DEFAULT_CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good", "Fair", "Poor", "ungraded"];
const DEFAULT_GAME_TYPES = ["Pokemon", "Yu-Gi-Oh!", "Magic: The Gathering", "Other TCG"];
const DEFAULT_SPORT_TYPES = ["Baseball", "Basketball", "Football", "Hockey", "Soccer", "Other"];
const SORT_OPTIONS = [
  { value: "created_at", label: "Date Added" },
  { value: "card_name", label: "Name" },
  { value: "current_price_raw", label: "Price" },
  { value: "rarity", label: "Rarity" },
  { value: "card_set", label: "Set" },
];

export default function AdvancedFilters({ 
  onFilterChange, 
  availableSets, 
  availableRarities,
  availableGameTypes = [],
  availableSportTypes = [],
  availableConditions = [],
  availableCollections = [],
  initialFilters = {},
}: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterConfig>(initialFilters);
  const [savedFilters, setSavedFilters] = useState<Array<{ id: string; filter_name: string; filter_config: any }>>([]);
  const [filterName, setFilterName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Merge available values with defaults
  const conditions = [...new Set([...DEFAULT_CONDITIONS, ...availableConditions])];
  const gameTypes = [...new Set([...DEFAULT_GAME_TYPES, ...availableGameTypes])];
  const sportTypes = [...new Set([...DEFAULT_SPORT_TYPES, ...availableSportTypes])];

  useEffect(() => {
    loadSavedFilters();
  }, []);

  useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      setFilters(initialFilters);
    }
  }, [initialFilters]);

  const loadSavedFilters = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from("saved_filters")
      .select("*")
      .eq("user_id", session.user.id);

    if (!error && data) {
      setSavedFilters(data);
    }
  };

  const handleFilterChange = (key: keyof FilterConfig, value: any) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleArrayFilterChange = (key: keyof FilterConfig, value: string) => {
    const currentArray = (filters[key] as string[]) || [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    
    handleFilterChange(key, newArray.length > 0 ? newArray : undefined);
  };

  const clearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  const saveCurrentFilter = async () => {
    if (!filterName.trim()) {
      toast.error("Please enter a filter name");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from("saved_filters")
      .insert({
        user_id: session.user.id,
        filter_name: filterName,
        filter_config: filters as any,
      });

    if (error) {
      toast.error("Failed to save filter");
    } else {
      toast.success("Filter saved successfully");
      setFilterName("");
      setShowSaveDialog(false);
      loadSavedFilters();
    }
  };

  const loadFilter = (config: FilterConfig) => {
    setFilters(config);
    onFilterChange(config);
    toast.success("Filter applied");
  };

  const deleteFilter = async (id: string) => {
    const { error } = await supabase
      .from("saved_filters")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete filter");
    } else {
      toast.success("Filter deleted");
      loadSavedFilters();
    }
  };

  const activeFilterCount = Object.entries(filters).filter(([key, v]) => {
    if (key === 'sortBy' || key === 'sortOrder') return false;
    return v !== undefined && (Array.isArray(v) ? v.length > 0 : true);
  }).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border bg-card">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <span className="font-semibold">Filters & Sorting</span>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {activeFilterCount} active
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); clearFilters(); }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
              {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6 border-t border-border">
            {/* Sort Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div>
                <Label className="text-sm font-medium">Sort By</Label>
                <Select
                  value={filters.sortBy || "created_at"}
                  onValueChange={(value) => handleFilterChange("sortBy", value)}
                >
                  <SelectTrigger className="mt-1.5 bg-background">
                    <SelectValue placeholder="Sort by..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50">
                    {SORT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Order</Label>
                <div className="flex gap-2 mt-1.5">
                  <Button
                    variant={filters.sortOrder !== 'asc' ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleFilterChange("sortOrder", "desc")}
                  >
                    <SortDesc className="h-4 w-4 mr-1" />
                    Newest/Highest
                  </Button>
                  <Button
                    variant={filters.sortOrder === 'asc' ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleFilterChange("sortOrder", "asc")}
                  >
                    <SortAsc className="h-4 w-4 mr-1" />
                    Oldest/Lowest
                  </Button>
                </div>
              </div>
            </div>

            {/* Price Range */}
            <div>
              <Label className="text-sm font-medium">Price Range</Label>
              <div className="grid grid-cols-2 gap-4 mt-1.5">
                <Input
                  type="number"
                  placeholder="Min $"
                  value={filters.priceMin || ""}
                  onChange={(e) => handleFilterChange("priceMin", e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="bg-background"
                />
                <Input
                  type="number"
                  placeholder="Max $"
                  value={filters.priceMax || ""}
                  onChange={(e) => handleFilterChange("priceMax", e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="bg-background"
                />
              </div>
            </div>

            {/* Rarity */}
            {availableRarities.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Rarity</Label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {availableRarities.map(rarity => (
                    <Badge
                      key={rarity}
                      variant={filters.rarity?.includes(rarity) ? "default" : "outline"}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => handleArrayFilterChange("rarity", rarity)}
                    >
                      {rarity}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Condition */}
            <div>
              <Label className="text-sm font-medium">Condition</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {conditions.map(condition => (
                  <Badge
                    key={condition}
                    variant={filters.condition?.includes(condition) ? "default" : "outline"}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleArrayFilterChange("condition", condition)}
                  >
                    {condition}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Game Type */}
            <div>
              <Label className="text-sm font-medium">Card Type (TCG)</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {gameTypes.map(type => (
                  <Badge
                    key={type}
                    variant={filters.gameType?.includes(type) ? "default" : "outline"}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleArrayFilterChange("gameType", type)}
                  >
                    {type}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Sport Type */}
            <div>
              <Label className="text-sm font-medium">Sport Type</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {sportTypes.map(type => (
                  <Badge
                    key={type}
                    variant={filters.sportType?.includes(type) ? "default" : "outline"}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleArrayFilterChange("sportType", type)}
                  >
                    {type}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Card Set */}
            {availableSets.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Card Set</Label>
                <Select
                  value={filters.cardSet?.[0] || "all"}
                  onValueChange={(value) => handleFilterChange("cardSet", value && value !== "all" ? [value] : undefined)}
                >
                  <SelectTrigger className="mt-1.5 bg-background">
                    <SelectValue placeholder="All sets" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50 max-h-60">
                    <SelectItem value="all">All sets</SelectItem>
                    {availableSets.map(set => (
                      <SelectItem key={set} value={set}>{set}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Collection Name */}
            {availableCollections.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Collection</Label>
                <Select
                  value={filters.collectionName || "all"}
                  onValueChange={(value) => handleFilterChange("collectionName", value && value !== "all" ? value : undefined)}
                >
                  <SelectTrigger className="mt-1.5 bg-background">
                    <SelectValue placeholder="All collections" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50">
                    <SelectItem value="all">All collections</SelectItem>
                    {availableCollections.map(coll => (
                      <SelectItem key={coll} value={coll}>{coll}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date Range */}
            <div>
              <Label className="text-sm font-medium">Date Added</Label>
              <div className="grid grid-cols-2 gap-4 mt-1.5">
                <div>
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={filters.dateFrom || ""}
                    onChange={(e) => handleFilterChange("dateFrom", e.target.value || undefined)}
                    className="bg-background"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={filters.dateTo || ""}
                    onChange={(e) => handleFilterChange("dateTo", e.target.value || undefined)}
                    className="bg-background"
                  />
                </div>
              </div>
            </div>

            {/* Save/Load Filters */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={activeFilterCount === 0}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Filter
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-background border-border">
                  <DialogHeader>
                    <DialogTitle>Save Filter Preset</DialogTitle>
                    <DialogDescription>Give this filter configuration a name to save it for later use</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="filter-name">Filter Name</Label>
                      <Input
                        id="filter-name"
                        value={filterName}
                        onChange={(e) => setFilterName(e.target.value)}
                        placeholder="e.g., High Value Cards"
                        className="bg-background"
                      />
                    </div>
                    <Button onClick={saveCurrentFilter} className="w-full">Save Filter</Button>
                  </div>
                </DialogContent>
              </Dialog>

              {savedFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Saved:</span>
                  {savedFilters.map(saved => (
                    <div key={saved.id} className="flex items-center gap-1">
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => loadFilter(saved.filter_config)}
                      >
                        {saved.filter_name}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:text-destructive"
                        onClick={() => deleteFilter(saved.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
