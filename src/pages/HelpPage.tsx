import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard,
  ScanLine,
  FolderOpen,
  BookOpen,
  Settings,
  Lightbulb,
  Activity,
  Brain,
  Award,
  Search,
  DollarSign,
  Camera,
  Upload,
  RefreshCw,
  Target,
  Smartphone,
  Usb,
  Filter,
  Trash2,
  Edit3,
  Download,
  ImagePlus,
  Shield,
  TrendingUp,
  Zap,
  HelpCircle,
  ChevronRight,
} from "lucide-react";

interface HelpSection {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  features: {
    name: string;
    description: string;
    tips?: string[];
  }[];
}

const helpSections: HelpSection[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    description: "Your collection overview with key stats, charts, and quick actions.",
    features: [
      {
        name: "Total Cards",
        description: "Shows the total number of cards in your collection and how many were scanned today.",
      },
      {
        name: "Total Value",
        description: "The combined raw value of all cards in your collection based on current market prices.",
      },
      {
        name: "Value Trend",
        description: "Percentage change in collection value compared to the previous week.",
      },
      {
        name: "Collection Ceiling (PSA 10)",
        description: "Maximum potential value if all your cards were graded PSA 10. Shows how many cards have PSA 10 prices looked up.",
        tips: ["Run PSA 10 lookup from Collections to get complete ceiling estimates"],
      },
      {
        name: "Scan Center",
        description: "Quick access buttons to scan single cards, binder pages, or bulk upload multiple images.",
      },
      {
        name: "AI Collection Advisor",
        description: "Get AI-powered recommendations about your collection, including which cards to hold, sell, or target.",
      },
      {
        name: "Value Over Time Chart",
        description: "Visual representation of your collection value changes over the past 30 days.",
      },
      {
        name: "Rarity Distribution",
        description: "Pie chart showing the breakdown of card rarities in your collection.",
      },
    ],
  },
  {
    id: "scan",
    title: "Scan",
    icon: ScanLine,
    description: "Capture and identify cards using camera or file upload with AI-powered recognition.",
    features: [
      {
        name: "Camera Tab",
        description: "Use your device camera to capture card images. Supports auto-focus and high-resolution capture.",
        tips: ["Hold steady and ensure good lighting", "Center the card in the frame"],
      },
      {
        name: "Upload Tab",
        description: "Drag and drop or browse to upload card images from your device.",
        tips: ["Supports JPG, PNG, and WebP formats", "Select multiple files for batch scanning"],
      },
      {
        name: "Phone Camera Tab",
        description: "Use your phone as a remote scanner. Scan the QR code on desktop to connect your phone.",
        tips: ["Phone camera often has better quality than webcam"],
      },
      {
        name: "USB Camera Tab",
        description: "Connect external USB cameras or document scanners for high-quality captures.",
      },
      {
        name: "Rapid Scan Mode",
        description: "Fast continuous scanning mode. Automatically captures and processes cards in quick succession.",
        tips: ["Great for scanning large collections quickly"],
      },
      {
        name: "Card Identification Editor",
        description: "After scanning, review and edit the detected card information before saving.",
      },
      {
        name: "Alternative Matches",
        description: "If the AI suggests the wrong card, view and select from alternative matches.",
      },
      {
        name: "Duplicate Detection",
        description: "Automatically detects if you're scanning a card that already exists in your collection.",
      },
    ],
  },
  {
    id: "graded",
    title: "Graded Cards",
    icon: Award,
    description: "Scan and verify professionally graded cards from PSA, CGC, and Beckett.",
    features: [
      {
        name: "Graded Card Scanner",
        description: "Upload or photograph graded slabs. The AI reads the label to extract grading info.",
      },
      {
        name: "Cert Number Extraction",
        description: "Automatically extracts the certification number from graded slabs.",
      },
      {
        name: "Auto-Verification",
        description: "Optionally verify the card against the grading company's database.",
        tips: ["Verification confirms authenticity and matches slab data"],
      },
      {
        name: "Grade Detection",
        description: "Reads the grade (e.g., PSA 10, BGS 9.5) from the slab label.",
      },
      {
        name: "Graded Card Pricing",
        description: "Fetches current market prices specific to the graded condition.",
      },
    ],
  },
  {
    id: "collections",
    title: "Collections",
    icon: FolderOpen,
    description: "Browse, filter, edit, and manage all cards in your collection.",
    features: [
      {
        name: "Card Grid",
        description: "Visual grid view of all your cards with images, names, and prices.",
      },
      {
        name: "Search Bar",
        description: "Search cards by name, set, player, or any other attribute.",
      },
      {
        name: "Advanced Filters",
        description: "Filter by rarity, condition, set, game type, sport type, price range, and collection name.",
        tips: ["Combine multiple filters to narrow down results"],
      },
      {
        name: "Card Selection",
        description: "Click cards to select them for bulk actions. Use shift+click for range selection.",
      },
      {
        name: "Bulk Edit",
        description: "Edit condition, rarity, set, or collection for multiple selected cards at once.",
      },
      {
        name: "Bulk Delete",
        description: "Delete multiple selected cards. Also options to delete recent imports or cards without images.",
      },
      {
        name: "Card Detail Modal",
        description: "Click a card to view full details, edit information, view price history, and manage images.",
      },
      {
        name: "Image Lookup",
        description: "Automatically find and attach card images from online databases.",
      },
      {
        name: "PSA 10 Price Update",
        description: "Look up potential PSA 10 values for cards to see their collection ceiling.",
      },
      {
        name: "Export Collection",
        description: "Download your collection data as CSV or Excel for backup or external analysis.",
      },
    ],
  },
  {
    id: "binders",
    title: "Binders",
    icon: BookOpen,
    description: "Organize cards into virtual binders with 9-pocket page layouts.",
    features: [
      {
        name: "Create Binder",
        description: "Create named binders to organize your collection (e.g., 'Pokemon Base Set', 'Vintage Basketball').",
      },
      {
        name: "Binder Page Scan",
        description: "Photograph entire 9-pocket binder pages. AI detects and splits into individual cards.",
        tips: ["Lay page flat with even lighting", "All 9 slots will be processed automatically"],
      },
      {
        name: "Page View",
        description: "View binder pages in the classic 3x3 grid layout.",
      },
      {
        name: "Slot Management",
        description: "Assign cards to specific slots, rearrange, or leave slots empty.",
      },
    ],
  },
  {
    id: "visual-search",
    title: "Visual Search",
    icon: Search,
    description: "Find cards using image similarity - upload an image to find matching cards.",
    features: [
      {
        name: "Image Upload",
        description: "Upload a card image to find visually similar cards in databases.",
      },
      {
        name: "Similarity Matching",
        description: "Uses AI to find cards that look similar to your uploaded image.",
        tips: ["Useful when you don't know the card name", "Works across different card games"],
      },
      {
        name: "Search Results",
        description: "View matching cards ranked by similarity with prices and details.",
      },
    ],
  },
  {
    id: "price-hub",
    title: "Price Hub",
    icon: DollarSign,
    description: "Look up card prices, compare grader values, and manage pricing settings.",
    features: [
      {
        name: "Price Search",
        description: "Search for specific card prices by entering set, year, player/name, and card number.",
      },
      {
        name: "Grader Selection",
        description: "Choose grading company (PSA, CGC, Beckett) and grade to get specific pricing.",
      },
      {
        name: "Grade Equivalents",
        description: "Compare prices across different grading companies for the same card.",
        tips: ["Helpful for arbitrage opportunities"],
      },
      {
        name: "Grader Premiums Admin",
        description: "Configure premium multipliers for different graders and grades.",
      },
      {
        name: "Price Sources",
        description: "Aggregates data from multiple sources: eBay sold listings, TCGPlayer, SportCardPro, PriceCharting.",
      },
    ],
  },
  {
    id: "predictions",
    title: "Value Predictor",
    icon: Brain,
    description: "AI-powered predictions for future card values based on trends and data.",
    features: [
      {
        name: "Value Predictions",
        description: "Get AI predictions for where card values might go in the future.",
      },
      {
        name: "Trend Analysis",
        description: "View historical trends and factors affecting card values.",
      },
      {
        name: "Market Insights",
        description: "Understand market conditions that may impact your collection.",
      },
    ],
  },
  {
    id: "insights",
    title: "AI Insights",
    icon: Lightbulb,
    description: "AI-generated analysis and recommendations for your collection.",
    features: [
      {
        name: "Collection Analysis",
        description: "AI reviews your entire collection and provides actionable insights.",
      },
      {
        name: "Hold/Sell Recommendations",
        description: "Suggestions on which cards to hold and which might be good to sell.",
      },
      {
        name: "Set Completion",
        description: "Track progress toward completing sets and get suggestions for missing cards.",
      },
      {
        name: "Value Opportunities",
        description: "Identify undervalued cards in your collection.",
      },
    ],
  },
  {
    id: "performance",
    title: "Performance",
    icon: Activity,
    description: "Analytics and performance metrics for your collection.",
    features: [
      {
        name: "Value Charts",
        description: "Track your collection value over time with interactive charts.",
      },
      {
        name: "Scan Statistics",
        description: "View scanning activity and success rates.",
      },
      {
        name: "Top Performers",
        description: "See which cards have gained the most value.",
      },
      {
        name: "Rarity Breakdown",
        description: "Analyze your collection composition by rarity.",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
    description: "Configure your account, scanning preferences, and integrations.",
    features: [
      {
        name: "Profile Settings",
        description: "Update your email, username, and password.",
      },
      {
        name: "Scanner Settings",
        description: "Configure OCR confidence thresholds, auto-save preferences, and camera settings.",
      },
      {
        name: "Bulk Operations",
        description: "Run bulk PSA 10 price lookups, rarity reanalysis, and image lookups.",
      },
      {
        name: "Data Management",
        description: "Delete cards without images, unknown cards, or clear entire collection.",
      },
      {
        name: "Import/Export",
        description: "Import cards from external services or export your collection.",
      },
      {
        name: "n8n Integrations",
        description: "Connect to n8n workflows for automation and external integrations.",
      },
      {
        name: "Device Storage",
        description: "Manage locally cached data and storage settings.",
      },
      {
        name: "Price Update",
        description: "Refresh prices for all cards in your collection from latest market data.",
      },
    ],
  },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const filteredSections = helpSections.filter((section) => {
    const query = searchQuery.toLowerCase();
    if (!query) return true;
    
    if (section.title.toLowerCase().includes(query)) return true;
    if (section.description.toLowerCase().includes(query)) return true;
    
    return section.features.some(
      (f) =>
        f.name.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <HelpCircle className="h-8 w-8 text-primary" />
          Help Center
        </h1>
        <p className="text-muted-foreground mt-1">
          Learn how to use every feature in Card Scanner
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search help topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="detailed">Detailed Guide</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSections.map((section) => (
              <Card
                key={section.id}
                className="hover-lift cursor-pointer transition-all"
                onClick={() => {
                  setActiveTab("detailed");
                  setTimeout(() => {
                    document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth" });
                  }, 100);
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <section.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{section.title}</CardTitle>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {section.features.length} features
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                  <div className="flex items-center gap-1 mt-3 text-xs text-primary">
                    View details <ChevronRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="detailed" className="mt-6">
          <ScrollArea className="h-[calc(100vh-300px)]">
            <div className="space-y-6 pr-4">
              {filteredSections.map((section) => (
                <Card key={section.id} id={`section-${section.id}`}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <section.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-xl">{section.title}</CardTitle>
                        <CardDescription>{section.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="multiple" className="w-full">
                      {section.features.map((feature, idx) => (
                        <AccordionItem key={idx} value={`${section.id}-${idx}`}>
                          <AccordionTrigger className="text-sm font-medium">
                            {feature.name}
                          </AccordionTrigger>
                          <AccordionContent>
                            <p className="text-sm text-muted-foreground mb-2">
                              {feature.description}
                            </p>
                            {feature.tips && feature.tips.length > 0 && (
                              <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                                <p className="text-xs font-medium text-primary mb-2 flex items-center gap-1">
                                  <Zap className="h-3 w-3" /> Tips
                                </p>
                                <ul className="text-xs text-muted-foreground space-y-1">
                                  {feature.tips.map((tip, tipIdx) => (
                                    <li key={tipIdx} className="flex items-start gap-2">
                                      <span className="text-primary">•</span>
                                      {tip}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Quick Reference */}
      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Quick Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <p className="font-medium">Scanning Cards</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>• Use good lighting for best results</li>
                <li>• Center card in frame</li>
                <li>• Hold camera steady</li>
                <li>• Use Phone Camera for best quality</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Managing Collection</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>• Use filters to find specific cards</li>
                <li>• Click card for full details</li>
                <li>• Select multiple for bulk actions</li>
                <li>• Run PSA 10 lookup for ceiling value</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Pricing</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>• Prices update from multiple sources</li>
                <li>• PSA 10 shows potential graded value</li>
                <li>• Collection Ceiling = sum of PSA 10 prices</li>
                <li>• Use Price Hub for manual lookups</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
