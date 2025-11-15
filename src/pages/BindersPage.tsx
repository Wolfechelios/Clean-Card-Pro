import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, BookOpen, Trash2, Eye, Grid3x3, List } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Binder {
  id: string;
  name: string;
  description: string;
  cardCount: number;
  totalValue: number;
  created_at: string;
}

interface BinderCard {
  id: string;
  card_name: string;
  card_set: string | null;
  image_url: string;
  thumbnail_url: string | null;
  current_price_raw: number | null;
  collection_name: string | null;
}

export default function BindersPage() {
  const [binders, setBinders] = useState<Binder[]>([]);
  const [selectedBinder, setSelectedBinder] = useState<string | null>(null);
  const [binderCards, setBinderCards] = useState<BinderCard[]>([]);
  const [availableCards, setAvailableCards] = useState<BinderCard[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [newBinder, setNewBinder] = useState({ name: "", description: "" });

  useEffect(() => {
    fetchBinders();
    fetchAvailableCards();
  }, []);

  useEffect(() => {
    if (selectedBinder) {
      fetchBinderCards(selectedBinder);
    }
  }, [selectedBinder]);

  const fetchBinders = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { data: cards } = await supabase
      .from("cards")
      .select("collection_name, current_price_raw")
      .eq("user_id", session.session.user.id);

    if (cards) {
      const binderMap = new Map<string, { count: number; value: number }>();
      
      cards.forEach(card => {
        const binderName = card.collection_name || "Unsorted";
        const current = binderMap.get(binderName) || { count: 0, value: 0 };
        binderMap.set(binderName, {
          count: current.count + 1,
          value: current.value + (card.current_price_raw || 0)
        });
      });

      const binderList: Binder[] = Array.from(binderMap.entries()).map(([name, data]) => ({
        id: name,
        name: name,
        description: `${data.count} cards`,
        cardCount: data.count,
        totalValue: data.value,
        created_at: new Date().toISOString(),
      }));

      setBinders(binderList);
    }
  };

  const fetchBinderCards = async (binderName: string) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const query = supabase
      .from("cards")
      .select("id, card_name, card_set, image_url, thumbnail_url, current_price_raw, collection_name")
      .eq("user_id", session.session.user.id);

    if (binderName === "Unsorted") {
      query.is("collection_name", null);
    } else {
      query.eq("collection_name", binderName);
    }

    const { data } = await query;
    setBinderCards(data || []);
  };

  const fetchAvailableCards = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { data } = await supabase
      .from("cards")
      .select("id, card_name, card_set, image_url, thumbnail_url, current_price_raw, collection_name")
      .eq("user_id", session.session.user.id);

    setAvailableCards(data || []);
  };

  const createBinder = async () => {
    if (!newBinder.name.trim()) {
      toast.error("Please enter a binder name");
      return;
    }

    toast.success(`Binder "${newBinder.name}" created`);
    setNewBinder({ name: "", description: "" });
    setIsCreateOpen(false);
    fetchBinders();
  };

  const addCardToBinder = async (cardId: string, binderName: string) => {
    const { error } = await supabase
      .from("cards")
      .update({ collection_name: binderName })
      .eq("id", cardId);

    if (error) {
      toast.error("Failed to add card to binder");
    } else {
      toast.success("Card added to binder");
      fetchBinders();
      if (selectedBinder) {
        fetchBinderCards(selectedBinder);
      }
      fetchAvailableCards();
    }
  };

  const removeCardFromBinder = async (cardId: string) => {
    const { error } = await supabase
      .from("cards")
      .update({ collection_name: null })
      .eq("id", cardId);

    if (error) {
      toast.error("Failed to remove card");
    } else {
      toast.success("Card removed from binder");
      fetchBinders();
      if (selectedBinder) {
        fetchBinderCards(selectedBinder);
      }
    }
  };

  const deleteBinder = async (binderName: string) => {
    const { error } = await supabase
      .from("cards")
      .update({ collection_name: null })
      .eq("collection_name", binderName);

    if (error) {
      toast.error("Failed to delete binder");
    } else {
      toast.success("Binder deleted and cards moved to unsorted");
      setSelectedBinder(null);
      fetchBinders();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Binders</h1>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Binder
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-neutral-900 border-neutral-800">
            <DialogHeader>
              <DialogTitle>Create New Binder</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Binder Name</Label>
                <Input
                  value={newBinder.name}
                  onChange={(e) => setNewBinder({ ...newBinder, name: e.target.value })}
                  placeholder="My Rare Cards"
                  className="bg-neutral-800 border-neutral-700"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={newBinder.description}
                  onChange={(e) => setNewBinder({ ...newBinder, description: e.target.value })}
                  placeholder="Collection of rare and valuable cards"
                  className="bg-neutral-800 border-neutral-700"
                />
              </div>
              <Button onClick={createBinder} className="w-full">Create Binder</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle>My Binders ({binders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {binders.map((binder) => (
                <div
                  key={binder.id}
                  className={`p-3 rounded cursor-pointer transition-colors ${
                    selectedBinder === binder.id
                      ? "bg-purple-600/20 border border-purple-600"
                      : "bg-neutral-800 hover:bg-neutral-700"
                  }`}
                  onClick={() => setSelectedBinder(binder.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        <h3 className="font-semibold">{binder.name}</h3>
                      </div>
                      <p className="text-sm text-neutral-400 mt-1">
                        {binder.cardCount} cards • ${binder.totalValue.toFixed(2)}
                      </p>
                    </div>
                    {binder.id !== "Unsorted" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBinder(binder.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {selectedBinder ? (
            <Card className="bg-neutral-900 border-neutral-800">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{selectedBinder}</CardTitle>
                  <div className="flex gap-2">
                    <Dialog open={isAddCardOpen} onOpenChange={setIsAddCardOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus className="mr-2 h-4 w-4" />
                          Add Cards
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-neutral-900 border-neutral-800 max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Add Cards to {selectedBinder}</DialogTitle>
                        </DialogHeader>
                        <div className="max-h-96 overflow-y-auto">
                          <div className="grid grid-cols-2 gap-3">
                            {availableCards
                              .filter(card => card.collection_name !== selectedBinder)
                              .map((card) => (
                                <div
                                  key={card.id}
                                  className="p-2 bg-neutral-800 rounded cursor-pointer hover:bg-neutral-700"
                                  onClick={() => {
                                    addCardToBinder(card.id, selectedBinder);
                                    setIsAddCardOpen(false);
                                  }}
                                >
                                  <img
                                    src={card.thumbnail_url || card.image_url}
                                    alt={card.card_name}
                                    className="w-full h-24 object-cover rounded mb-2"
                                  />
                                  <p className="text-sm font-medium truncate">{card.card_name}</p>
                                  <p className="text-xs text-neutral-400 truncate">{card.card_set}</p>
                                </div>
                              ))}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <div className="flex gap-1 border border-neutral-700 rounded">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setViewMode("grid")}
                        className={viewMode === "grid" ? "bg-neutral-700" : ""}
                      >
                        <Grid3x3 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setViewMode("list")}
                        className={viewMode === "list" ? "bg-neutral-700" : ""}
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {binderCards.map((card) => (
                      <div key={card.id} className="group relative">
                        <img
                          src={card.thumbnail_url || card.image_url}
                          alt={card.card_name}
                          className="w-full aspect-[3/4] object-cover rounded"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => removeCardFromBinder(card.id)}
                          >
                            Remove
                          </Button>
                        </div>
                        <p className="text-sm font-medium mt-1 truncate">{card.card_name}</p>
                        <p className="text-xs text-neutral-400">${(card.current_price_raw || 0).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {binderCards.map((card) => (
                      <div key={card.id} className="flex items-center gap-3 p-3 bg-neutral-800 rounded">
                        <img
                          src={card.thumbnail_url || card.image_url}
                          alt={card.card_name}
                          className="w-16 h-16 object-cover rounded"
                        />
                        <div className="flex-1">
                          <p className="font-medium">{card.card_name}</p>
                          <p className="text-sm text-neutral-400">{card.card_set}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">${(card.current_price_raw || 0).toFixed(2)}</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeCardFromBinder(card.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {binderCards.length === 0 && (
                  <div className="text-center py-12 text-neutral-400">
                    <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No cards in this binder yet</p>
                    <Button className="mt-4" onClick={() => setIsAddCardOpen(true)}>
                      Add Your First Card
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-neutral-900 border-neutral-800 h-full flex items-center justify-center">
              <CardContent className="text-center py-12">
                <BookOpen className="h-16 w-16 mx-auto mb-4 text-neutral-600" />
                <p className="text-neutral-400">Select a binder to view its contents</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
