import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Search, DollarSign, RefreshCw, ArrowLeftRight, Settings } from "lucide-react";
import { PriceCard } from "@/components/pricing/PriceCard";
import { GraderPremiumAdmin } from "@/components/pricing/GraderPremiumAdmin";

interface CardIdentifier {
  set?: string;
  year?: string;
  player?: string;
  name?: string;
  card_number?: string;
  variant?: string;
}

interface PricingData {
  canonical_card: CardIdentifier;
  aggregated: {
    price_USD: number;
    price_type: string;
    confidence_score: number;
  };
  comps: any[];
  populations: any;
  providers: { name: string; status: string; error?: string }[];
  notes: string[];
  last_updated: string;
}

interface GradeEquivalent {
  grader: string;
  grade: string;
  equivalent_grade: string;
  price_parity: number;
  population_ratio: number;
  confidence: number;
}

export default function CardPriceHubPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("search");
  
  // Search state
  const [cardSet, setCardSet] = useState("");
  const [cardYear, setCardYear] = useState("");
  const [cardPlayer, setCardPlayer] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardVariant, setCardVariant] = useState("");
  const [grader, setGrader] = useState<string>("");
  const [grade, setGrade] = useState<string>("");
  const [forceRefresh, setForceRefresh] = useState(false);
  
  // Results state
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Grade equivalents state
  const [sourceGrader, setSourceGrader] = useState("PSA");
  const [sourceGrade, setSourceGrade] = useState("10");
  const [targetGrader, setTargetGrader] = useState("");
  const [equivalents, setEquivalents] = useState<GradeEquivalent[]>([]);
  const [equivLoading, setEquivLoading] = useState(false);

  const handleSearch = async () => {
    if (!cardPlayer && !cardSet && !cardNumber) {
      toast.error("Please enter at least one search field");
      return;
    }

    setLoading(true);
    setPricingData(null);

    try {
      const card: CardIdentifier = {};
      if (cardSet) card.set = cardSet;
      if (cardYear) card.year = cardYear;
      if (cardPlayer) card.player = cardPlayer;
      if (cardNumber) card.card_number = cardNumber;
      if (cardVariant) card.variant = cardVariant;

      const options: any = { force_refresh: forceRefresh };
      if (grader) options.grader = grader;
      if (grade) options.grade = grade;

      const { data, error } = await supabase.functions.invoke("graded-card-pricing", {
        body: { card, options },
      });

      if (error) throw error;
      
      setPricingData(data);
      toast.success(`Found ${data.comps?.length || 0} comparable sales`);
    } catch (err) {
      console.error("Pricing error:", err);
      toast.error("Failed to fetch pricing data");
    } finally {
      setLoading(false);
    }
  };

  const handleGradeEquivalents = async () => {
    setEquivLoading(true);
    setEquivalents([]);

    try {
      const { data, error } = await supabase.functions.invoke("grade-equivalents", {
        body: {
          graderA: sourceGrader,
          gradeA: sourceGrade,
          graderB: targetGrader || undefined,
        },
      });

      if (error) throw error;
      
      setEquivalents(data.equivalents || []);
      toast.success(`Found ${data.equivalents?.length || 0} equivalent grades`);
    } catch (err) {
      console.error("Equivalents error:", err);
      toast.error("Failed to fetch grade equivalents");
    } finally {
      setEquivLoading(false);
    }
  };

  const psaGrades = ["10", "9", "8", "7", "6", "5", "4"];
  const bgsGrades = ["10", "9.5", "9", "8.5", "8", "7.5", "7"];
  const cgcGrades = ["10", "9.5", "9", "8.5", "8", "7.5", "7"];

  const getGradeOptions = (selectedGrader: string) => {
    switch (selectedGrader) {
      case "PSA": return psaGrades;
      case "BGS": return bgsGrades;
      case "CGC": return cgcGrades;
      default: return psaGrades;
    }
  };

  return (
    <div className="container max-w-6xl mx-auto py-6 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <DollarSign className="h-8 w-8 text-primary" />
              CardPriceHub
            </h1>
            <p className="text-muted-foreground mt-1">
              Market pricing for PSA, BGS, and CGC graded cards
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="equivalents" className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Equivalents
            </TabsTrigger>
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Admin
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Search Form */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Card Search</CardTitle>
                  <CardDescription>
                    Enter card details to find market pricing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="player">Player / Name</Label>
                      <Input
                        id="player"
                        placeholder="Michael Jordan"
                        value={cardPlayer}
                        onChange={(e) => setCardPlayer(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="year">Year</Label>
                      <Input
                        id="year"
                        placeholder="1986"
                        value={cardYear}
                        onChange={(e) => setCardYear(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="set">Set</Label>
                      <Input
                        id="set"
                        placeholder="Fleer"
                        value={cardSet}
                        onChange={(e) => setCardSet(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cardNumber">Card #</Label>
                      <Input
                        id="cardNumber"
                        placeholder="57"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="variant">Variant (optional)</Label>
                    <Input
                      id="variant"
                      placeholder="Refractor, Parallel, etc."
                      value={cardVariant}
                      onChange={(e) => setCardVariant(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="grader">Grader</Label>
                      <Select value={grader || "all"} onValueChange={(v) => setGrader(v === "all" ? "" : v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="All graders" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Graders</SelectItem>
                          <SelectItem value="PSA">PSA</SelectItem>
                          <SelectItem value="BGS">BGS (Beckett)</SelectItem>
                          <SelectItem value="CGC">CGC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="grade">Grade</Label>
                      <Select value={grade || "all"} onValueChange={(v) => setGrade(v === "all" ? "" : v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="All grades" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Grades</SelectItem>
                          {getGradeOptions(grader || "PSA").map((g) => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="forceRefresh"
                        checked={forceRefresh}
                        onCheckedChange={setForceRefresh}
                      />
                      <Label htmlFor="forceRefresh" className="text-sm">
                        Force refresh (skip cache)
                      </Label>
                    </div>
                  </div>

                  <Button 
                    onClick={handleSearch} 
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Get Pricing
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Results */}
              <PriceCard 
                data={pricingData} 
                loading={loading}
                grader={grader || undefined}
                grade={grade || undefined}
              />
            </div>
          </TabsContent>

          {/* Grade Equivalents Tab */}
          <TabsContent value="equivalents" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowLeftRight className="h-5 w-5" />
                    Grade Equivalents
                  </CardTitle>
                  <CardDescription>
                    Compare equivalent grades across grading companies
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Source Grader</Label>
                      <Select value={sourceGrader} onValueChange={setSourceGrader}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PSA">PSA</SelectItem>
                          <SelectItem value="BGS">BGS (Beckett)</SelectItem>
                          <SelectItem value="CGC">CGC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Source Grade</Label>
                      <Select value={sourceGrade} onValueChange={setSourceGrade}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getGradeOptions(sourceGrader).map((g) => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Target Grader (optional)</Label>
                    <Select value={targetGrader || "all"} onValueChange={(v) => setTargetGrader(v === "all" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="All graders" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Graders</SelectItem>
                        {["PSA", "BGS", "CGC"].filter(g => g !== sourceGrader).map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button 
                    onClick={handleGradeEquivalents}
                    disabled={equivLoading}
                    className="w-full"
                  >
                    {equivLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                        Find Equivalents
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Equivalents Results */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>
                    {sourceGrader} {sourceGrade} Equivalents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {equivalents.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      Select grades to compare
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {equivalents.map((eq, i) => (
                        <div 
                          key={i}
                          className="p-3 bg-muted/30 rounded-lg flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-foreground">
                              {eq.grader} {eq.equivalent_grade}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {Math.round(eq.confidence * 100)}% confidence
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-foreground">
                              {eq.price_parity}x price parity
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {eq.population_ratio}x pop ratio
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Admin Tab */}
          <TabsContent value="admin">
            <GraderPremiumAdmin />
          </TabsContent>
        </Tabs>
      </div>
  );
}