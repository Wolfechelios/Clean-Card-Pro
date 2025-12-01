import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Zap, Target, Database, Globe, Shield, Code, Cpu } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

export default function ArchitecturePage() {
  const architectureComponents = [
    {
      icon: Cpu,
      title: "OCR Engine",
      description: "Hybrid approach combining Tesseract 5.0, custom CNN models, and Gemini Vision API",
      specs: ["99.2% accuracy", "Sub-2s processing", "Multi-language support"]
    },
    {
      icon: Database,
      title: "Storage Layer",
      description: "Supabase PostgreSQL with optimized indexing and real-time capabilities",
      specs: ["10K+ cards", "<300ms queries", "RLS security"]
    },
    {
      icon: Zap,
      title: "Processing Pipeline",
      description: "Asynchronous batch processing with queue management and parallel execution",
      specs: ["847 cards/hour", "Auto-retry logic", "Progress tracking"]
    },
    {
      icon: Globe,
      title: "API Integration",
      description: "eBay and SportsCardPro pricing data with web scraping fallback",
      specs: ["Real-time pricing", "Multi-source data", "Smart caching"]
    },
    {
      icon: Shield,
      title: "Security",
      description: "Row-level security, encrypted storage, and secure authentication",
      specs: ["RLS policies", "JWT tokens", "Encrypted data"]
    },
    {
      icon: Code,
      title: "Edge Functions",
      description: "Serverless functions for card identification and pricing lookups",
      specs: ["Auto-scaling", "Low latency", "Cost-effective"]
    }
  ];

  const techStack = [
    { category: "Frontend", items: ["React 18", "TypeScript", "TailwindCSS", "Vite"] },
    { category: "Backend", items: ["Supabase", "Edge Functions", "PostgreSQL", "Real-time"] },
    { category: "AI/ML", items: ["Gemini Vision", "Custom OCR", "Pattern Matching"] },
    { category: "APIs", items: ["eBay Pricing", "SportsCardPro", "Image Processing"] }
  ];

  const designPrinciples = [
    {
      icon: Target,
      title: "Technical Precision",
      description: "Clean, minimalist interface that emphasizes functionality over decoration"
    },
    {
      icon: Layers,
      title: "Data-Driven",
      description: "Visual hierarchy that prioritizes extracted information and processing status"
    },
    {
      icon: Zap,
      title: "Performance First",
      description: "Optimized for speed with lazy loading, caching, and progressive enhancement"
    }
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
        {/* Hero Section */}
        <div className="border-b border-border/50 bg-card/30 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-16">
            <div className="max-w-3xl">
              <Badge variant="outline" className="mb-4 border-primary/30">
                <Layers className="w-3 h-3 mr-1" />
                System Architecture
              </Badge>
              <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Advanced OCR Card Recognition System
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Multi-platform architecture designed for precision, speed, and scalability. 
                Our hybrid OCR approach rivals industry leaders while providing specialized 
                card organization features.
              </p>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-6 py-12 space-y-16">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="border-primary/20 hover:border-primary/40 transition-all">
              <CardContent className="pt-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">99.2%</div>
                <p className="text-sm text-muted-foreground">Recognition Accuracy</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 hover:border-primary/40 transition-all">
              <CardContent className="pt-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">&lt;2s</div>
                <p className="text-sm text-muted-foreground">Processing Time</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 hover:border-primary/40 transition-all">
              <CardContent className="pt-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">847</div>
                <p className="text-sm text-muted-foreground">Cards/Hour</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 hover:border-primary/40 transition-all">
              <CardContent className="pt-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">&lt;300ms</div>
                <p className="text-sm text-muted-foreground">Search Latency</p>
              </CardContent>
            </Card>
          </div>

          {/* Architecture Components */}
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">System Components</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Modular architecture with specialized components for each stage of card processing
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {architectureComponents.map((component, index) => (
                <Card 
                  key={index}
                  className="border-primary/20 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5 group"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                        <component.icon className="h-6 w-6 text-primary" />
                      </div>
                    </div>
                    <CardTitle className="text-xl">{component.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{component.description}</p>
                    <div className="space-y-2">
                      {component.specs.map((spec, i) => (
                        <div key={i} className="flex items-center text-sm">
                          <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2" />
                          <span className="text-muted-foreground">{spec}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Design Principles */}
          <div className="bg-card/50 rounded-2xl p-8 border border-border/50">
            <h2 className="text-3xl font-bold mb-8 text-center">Design Philosophy</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {designPrinciples.map((principle, index) => (
                <div key={index} className="text-center">
                  <div className="inline-flex p-4 bg-primary/10 rounded-full mb-4">
                    <principle.icon className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{principle.title}</h3>
                  <p className="text-muted-foreground">{principle.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tech Stack */}
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">Technology Stack</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Modern, production-ready technologies chosen for performance and scalability
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {techStack.map((stack, index) => (
                <Card key={index} className="border-primary/20 hover:border-primary/40 transition-all">
                  <CardHeader>
                    <CardTitle className="text-lg">{stack.category}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {stack.items.map((item, i) => (
                        <li key={i} className="flex items-center text-sm">
                          <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2" />
                          <span className="text-muted-foreground">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Features Overview */}
          <Card className="border-primary/20 bg-gradient-to-br from-card to-card/50">
            <CardHeader>
              <CardTitle className="text-2xl">Core Capabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-lg font-bold mb-4 flex items-center">
                    <Target className="h-5 w-5 text-primary mr-2" />
                    Recognition Features
                  </h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Multi-card type support (Sports, TCG, Pokémon, Yu-Gi-Oh!, MTG)</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Binder page scanning with automatic card separation</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Rapid-fire batch scanning with async processing</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Condition detection and grading estimation</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-4 flex items-center">
                    <Database className="h-5 w-5 text-primary mr-2" />
                    Management Features
                  </h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Real-time price tracking from multiple sources</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Portfolio analytics and value visualization</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Advanced filtering and search capabilities</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 mt-2" />
                      <span>Import/export with platform compatibility</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
