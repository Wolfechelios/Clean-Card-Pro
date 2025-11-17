import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter, Save, Trash2 } from "lucide-react";
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

export interface FilterConfig {
  priceMin?: number;
  priceMax?: number;
  rarity?: string[];
  condition?: string[];
  cardSet?: string[];
  dateFrom?: string;
  dateTo?: string;
  collectionName?: string;
}

interface AdvancedFiltersProps {
  onFilterChange: (filters: FilterConfig) => void;
  availableSets: string[];
  availableRarities: string[];
}

export default function AdvancedFilters({ onFilterChange, availableSets, availableRarities }: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterConfig>({});
  const [savedFilters, setSavedFilters] = useState<Array<{ id: string; filter_name: string; filter_config: any }>>([]);
  const [filterName, setFilterName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => {
    loadSavedFilters();
  }, []);

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

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && (Array.isArray(v) ? v.length > 0 : true)).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            <CardTitle>Advanced Filters</CardTitle>
            {activeFilterCount > 0 && (
              <Badge variant="secondary">{activeFilterCount} active</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={activeFilterCount === 0}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </DialogTrigger>
              <DialogContent>
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
                    />
                  </div>
                  <Button onClick={saveCurrentFilter} className="w-full">Save Filter</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Min Price</Label>
            <Input
              type="number"
              placeholder="$0"
              value={filters.priceMin || ""}
              onChange={(e) => handleFilterChange("priceMin", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <Label>Max Price</Label>
            <Input
              type="number"
              placeholder="No limit"
              value={filters.priceMax || ""}
              onChange={(e) => handleFilterChange("priceMax", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
        </div>

        {/* Rarity */}
        <div>
          <Label>Rarity</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {availableRarities.map(rarity => (
              <Badge
                key={rarity}
                variant={filters.rarity?.includes(rarity) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => handleArrayFilterChange("rarity", rarity)}
              >
                {rarity}
              </Badge>
            ))}
          </div>
        </div>

        {/* Condition */}
        <div>
          <Label>Condition</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {["Mint", "Near Mint", "Excellent", "Good", "Fair", "Poor"].map(condition => (
              <Badge
                key={condition}
                variant={filters.condition?.includes(condition) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => handleArrayFilterChange("condition", condition)}
              >
                {condition}
              </Badge>
            ))}
          </div>
        </div>

        {/* Set */}
        <div>
          <Label>Card Set</Label>
          <Select
            value={filters.cardSet?.[0] || ""}
            onValueChange={(value) => handleFilterChange("cardSet", value ? [value] : undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All sets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All sets</SelectItem>
              {availableSets.map(set => (
                <SelectItem key={set} value={set}>{set}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Added From</Label>
            <Input
              type="date"
              value={filters.dateFrom || ""}
              onChange={(e) => handleFilterChange("dateFrom", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label>Added To</Label>
            <Input
              type="date"
              value={filters.dateTo || ""}
              onChange={(e) => handleFilterChange("dateTo", e.target.value || undefined)}
            />
          </div>
        </div>

        {/* Collection Name */}
        <div>
          <Label>Collection Name</Label>
          <Input
            placeholder="Filter by collection"
            value={filters.collectionName || ""}
            onChange={(e) => handleFilterChange("collectionName", e.target.value || undefined)}
          />
        </div>

        {/* Saved Filters */}
        {savedFilters.length > 0 && (
          <div>
            <Label>Saved Filters</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {savedFilters.map(saved => (
                <div key={saved.id} className="flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => loadFilter(saved.filter_config)}
                  >
                    {saved.filter_name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => deleteFilter(saved.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}