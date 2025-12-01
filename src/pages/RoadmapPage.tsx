import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Clock, Rocket, Users, DollarSign } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

export default function RoadmapPage() {
  const phases = [
    {
      number: 1,
      title: "Minimum Viable Product",
      status: "completed",
      statusLabel: "Completed",
      description: "Core OCR functionality with basic export capabilities and mobile deployment",
      duration: "4 months",
      teamSize: "4 developers",
      budget: "$800K",
      completion: 100,
      features: [
        "Sports & TCG card OCR",
        "Contact extraction",
        "CSV export functionality",
        "Mobile apps (iOS/Android)",
        "Basic pricing integration"
      ],
      milestone: "Successfully launched MVP with 95.2% accuracy and 2,500+ beta users"
    },
    {
      number: 2,
      title: "Advanced Features",
      status: "in-progress",
      statusLabel: "In Progress",
      description: "Multi-card type support, visual search, and enhanced pricing integration",
      duration: "5 months",
      teamSize: "6 developers",
      budget: "$1.2M",
      completion: 65,
      features: [
        "Trading card support",
        "Binder page scanning",
        "Visual similarity search",
        "Real-time price tracking",
        "Advanced analytics"
      ],
      milestone: "Target: 99.2% accuracy with 10K+ active users by Q2 2025"
    },
    {
      number: 3,
      title: "Enterprise Ready",
      status: "planned",
      statusLabel: "Planned",
      description: "Enterprise features, API access, and white-label solutions",
      duration: "3 months",
      teamSize: "8 developers",
      budget: "$500K",
      completion: 0,
      features: [
        "API access & webhooks",
        "White-label solutions",
        "Bulk operations",
        "Team collaboration",
        "Custom integrations"
      ],
      milestone: "Target: Enterprise contracts and API partnerships"
    }
  ];

  const techStackDecisions = [
    {
      category: "Frontend Framework",
      choice: "React + TypeScript",
      rationale: "Type safety, component reusability, large ecosystem"
    },
    {
      category: "Backend Platform",
      choice: "Supabase",
      rationale: "Built-in auth, real-time, PostgreSQL, edge functions"
    },
    {
      category: "OCR Engine",
      choice: "Gemini Vision API",
      rationale: "High accuracy, multimodal, cost-effective"
    },
    {
      category: "Styling",
      choice: "TailwindCSS",
      rationale: "Rapid development, consistency, small bundle size"
    },
    {
      category: "State Management",
      choice: "TanStack Query",
      rationale: "Server state caching, automatic refetching, optimistic updates"
    },
    {
      category: "Deployment",
      choice: "Vercel/Lovable",
      rationale: "Auto-deployment, edge network, serverless functions"
    }
  ];

  const risks = [
    {
      risk: "OCR Accuracy",
      mitigation: "Hybrid approach with multiple engines and manual override",
      severity: "Medium"
    },
    {
      risk: "Pricing API Costs",
      mitigation: "Web scraping fallback, caching, rate limiting",
      severity: "Low"
    },
    {
      risk: "Scale Performance",
      mitigation: "CDN, image optimization, batch processing queues",
      severity: "Medium"
    },
    {
      risk: "Competition",
      mitigation: "Specialized features, superior accuracy, better UX",
      severity: "Medium"
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
                <Rocket className="w-3 h-3 mr-1" />
                Development Roadmap
              </Badge>
              <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Implementation Roadmap
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Strategic development phases, technology stack decisions, and deployment timeline 
                from MVP to enterprise-ready solution.
              </p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
              <Card className="border-primary/20">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <Clock className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">12</div>
                    <p className="text-sm text-muted-foreground">Months to Market</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">8</div>
                    <p className="text-sm text-muted-foreground">Team Members</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">$2.5M</div>
                    <p className="text-sm text-muted-foreground">Total Investment</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-6 py-12 space-y-16">
          {/* Development Phases */}
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">Development Phases</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Three-phase approach from MVP to enterprise-ready solution
              </p>
            </div>

            <div className="space-y-8">
              {phases.map((phase) => (
                <Card 
                  key={phase.number}
                  className={`border-2 transition-all ${
                    phase.status === 'completed' 
                      ? 'border-green-500/30 bg-green-500/5' 
                      : phase.status === 'in-progress'
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border/30'
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-start gap-6">
                      <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                        phase.status === 'completed'
                          ? 'bg-green-500 text-white'
                          : phase.status === 'in-progress'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {phase.number}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <CardTitle className="text-2xl">{phase.title}</CardTitle>
                          <Badge variant={
                            phase.status === 'completed' ? 'default' :
                            phase.status === 'in-progress' ? 'secondary' : 'outline'
                          } className={
                            phase.status === 'completed' ? 'bg-green-500' :
                            phase.status === 'in-progress' ? 'bg-primary' : ''
                          }>
                            {phase.status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {phase.status === 'in-progress' && <Circle className="w-3 h-3 mr-1 animate-pulse" />}
                            {phase.statusLabel}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mb-4">{phase.description}</p>

                        {phase.status === 'in-progress' && (
                          <div className="mb-6">
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-muted-foreground">Overall Progress</span>
                              <span className="font-medium">{phase.completion}%</span>
                            </div>
                            <Progress value={phase.completion} className="h-2" />
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-2 gap-8">
                      <div>
                        <h4 className="font-bold mb-4">Key Features</h4>
                        <ul className="space-y-2">
                          {phase.features.map((feature, i) => (
                            <li key={i} className="flex items-center text-sm">
                              <div className={`w-1.5 h-1.5 rounded-full mr-2 ${
                                phase.status === 'completed' ? 'bg-green-500' :
                                phase.status === 'in-progress' ? 'bg-primary' : 'bg-muted-foreground'
                              }`} />
                              <span className="text-muted-foreground">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-bold mb-4">Timeline & Resources</h4>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Duration:</span>
                            <span className="font-medium">{phase.duration}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Team Size:</span>
                            <span className="font-medium">{phase.teamSize}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Budget:</span>
                            <span className="font-medium">{phase.budget}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className={`mt-6 p-4 rounded-lg ${
                      phase.status === 'completed' ? 'bg-green-500/10 border border-green-500/20' :
                      phase.status === 'in-progress' ? 'bg-primary/10 border border-primary/20' :
                      'bg-muted border border-border'
                    }`}>
                      <p className="text-sm font-medium mb-1">
                        {phase.status === 'completed' ? '✓ Milestone Achieved' :
                         phase.status === 'in-progress' ? '→ Current Target' : '○ Future Milestone'}
                      </p>
                      <p className="text-sm text-muted-foreground">{phase.milestone}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Tech Stack Decisions */}
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">Technology Decisions</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Strategic technology choices and architectural decisions
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {techStackDecisions.map((decision, index) => (
                <Card key={index} className="border-primary/20 hover:border-primary/40 transition-all">
                  <CardHeader>
                    <CardTitle className="text-lg">{decision.category}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <span className="text-sm text-muted-foreground">Choice: </span>
                      <span className="font-semibold text-primary">{decision.choice}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{decision.rationale}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Risk Assessment */}
          <Card className="border-primary/20 bg-gradient-to-br from-card to-card/50">
            <CardHeader>
              <CardTitle className="text-2xl">Risk Assessment & Mitigation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {risks.map((item, index) => (
                  <div key={index} className="flex items-start gap-4 p-4 bg-background/50 rounded-lg">
                    <Badge variant={
                      item.severity === 'Low' ? 'outline' : 
                      item.severity === 'Medium' ? 'secondary' : 'destructive'
                    }>
                      {item.severity}
                    </Badge>
                    <div className="flex-1">
                      <h4 className="font-bold mb-1">{item.risk}</h4>
                      <p className="text-sm text-muted-foreground">{item.mitigation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
