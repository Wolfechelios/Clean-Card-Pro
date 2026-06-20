import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Pencil, Trash2, Search, CheckSquare, MoveRight } from "lucide-react";
import { CardEditDialog } from "./CardEditDialog";

interface CardRow {
  id: string;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  ungraded_price: number | null;
  graded_price: number | null;
  grade9_price: number | null;
  psa10_price: number | null;
}

interface SetInfo {
  id: string;
  set_name: string;
  set_code: string | null;
  game: string;
}

interface SetCardsListProps {
  set: SetInfo;
  allSets: { id: string; set_name: string; set_code: string | null }[];
  onBack: () => void;
  onRefresh: () => void;
}

export function SetCardsList({ set, allSets, onBack, onRefresh }: SetCardsListProps) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editCard, setEditCard] = useState<CardRow | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pc_cards")
      .select("id, card_name, card_number, variant, ungraded_price, graded_price, grade9_price, psa10_price")
      .eq("set_id", set.id)
      .order("card_number");
    setCards(data || []);
    setLoading(false);
  }, [set.id]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const filtered = cards.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.card_name.toLowerCase().includes(q) || (c.card_number || "").toLowerCase().includes(q);
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    const { error } = await supabase.from("pc_cards").delete().in("id", ids);
    if (error) {
      toast.error("Failed to delete cards");
    } else {
      toast.success(`Deleted ${ids.length} card(s)`);
      setSelected(new Set());
      fetchCards();
      // Update set count
      const remaining = cards.length - ids.length;
      await supabase.from("pc_sets").update({ total_cards: remaining }).eq("id", set.id);
      onRefresh();
    }
  };

  const moveSelected = async () => {
    if (!moveTarget || moveTarget === set.id) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("pc_cards").update({ set_id: moveTarget }).in("id", ids);
    if (error) {
      toast.error("Failed to move cards");
    } else {
      toast.success(`Moved ${ids.length} card(s)`);
      setSelected(new Set());
      setMoveTarget("");
      fetchCards();
      // Update counts for both sets
      const { count: srcCount } = await supabase.from("pc_cards").select("id", { count: "exact", head: true }).eq("set_id", set.id);
      const { count: dstCount } = await supabase.from("pc_cards").select("id", { count: "exact", head: true }).eq("set_id", moveTarget);
      await supabase.from("pc_sets").update({ total_cards: srcCount || 0 }).eq("id", set.id);
      await supabase.from("pc_sets").update({ total_cards: dstCount || 0 }).eq("id", moveTarget);
      onRefresh();
    }
  };

  const deleteSingle = async (id: string) => {
    const { error } = await supabase.from("pc_cards").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete card");
    } else {
      toast.success("Card deleted");
      fetchCards();
      await supabase.from("pc_sets").update({ total_cards: cards.length - 1 }).eq("id", set.id);
      onRefresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold">{set.set_name} {set.set_code && <Badge variant="outline">{set.set_code}</Badge>}</h2>
        <Badge variant="secondary">{cards.length} cards</Badge>
      </div>

      {/* Search + Bulk Actions */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search cards..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {selected.size > 0 && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete {selected.size}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} card(s)?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="flex items-center gap-1">
              <Select value={moveTarget} onValueChange={setMoveTarget}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue placeholder="Move to set..." />
                </SelectTrigger>
                <SelectContent>
                  {allSets.filter((s) => s.id !== set.id).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.set_name} {s.set_code && `(${s.set_code})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={moveSelected} disabled={!moveTarget}>
                <MoveRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading...</div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                    </TableHead>
                    <TableHead>#</TableHead>
                    <TableHead>Card Name</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right">Raw</TableHead>
                    <TableHead className="text-right">Graded</TableHead>
                    <TableHead className="text-right">PSA 9</TableHead>
                    <TableHead className="text-right">PSA 10</TableHead>
                    <TableHead className="text-right w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                      </TableCell>
                      <TableCell className="text-xs font-mono">{c.card_number || "—"}</TableCell>
                      <TableCell className="text-sm">{c.card_name}</TableCell>
                      <TableCell className="text-xs">{c.variant || "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.ungraded_price ? `$${c.ungraded_price.toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.graded_price ? `$${c.graded_price.toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.grade9_price ? `$${c.grade9_price.toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.psa10_price ? `$${c.psa10_price.toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditCard(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete "{c.card_name}"?</AlertDialogTitle>
                              <AlertDialogDescription>This card will be permanently removed from the set.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSingle(c.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editCard && (
        <CardEditDialog
          open={!!editCard}
          onOpenChange={(open) => !open && setEditCard(null)}
          card={editCard}
          onSaved={fetchCards}
        />
      )}
    </div>
  );
}
