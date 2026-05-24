import { useState } from "react";
import { DollarSign, Sparkles, Trophy, Image as ImageIcon, Stars, Copy, ListChecks, RefreshCw, Award } from "lucide-react";
import TCGPlayerEnrichTab from "@/components/bulk/TCGPlayerEnrichTab";
import VintageAuditTab from "@/components/bulk/VintageAuditTab";
import SportsPriceEnrichTab from "@/components/bulk/SportsPriceEnrichTab";
import ImageBackfillTab from "@/components/bulk/ImageBackfillTab";
import RarityReanalyzeTab from "@/components/bulk/RarityReanalyzeTab";
import DuplicateMergeTab from "@/components/bulk/DuplicateMergeTab";
import SetCompletionTab from "@/components/bulk/SetCompletionTab";
import StalePriceRefreshTab from "@/components/bulk/StalePriceRefreshTab";
import GradeEstimateBackfillTab from "@/components/bulk/GradeEstimateBackfillTab";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Tool = { id: string; label: string; icon: typeof DollarSign; Comp: () => JSX.Element };
type Group = { label: string; tools: Tool[] };

const TOOL_GROUPS: Group[] = [
  {
    label: "Pricing",
    tools: [
      { id: "tcg", label: "TCG Prices", icon: DollarSign, Comp: TCGPlayerEnrichTab },
      { id: "sports", label: "Sports Prices", icon: Trophy, Comp: SportsPriceEnrichTab },
      { id: "stale", label: "Stale Refresh", icon: RefreshCw, Comp: StalePriceRefreshTab },
    ],
  },
  {
    label: "Data Quality",
    tools: [
      { id: "duplicates", label: "Duplicate Merge", icon: Copy, Comp: DuplicateMergeTab },
      { id: "set-number", label: "Set & Number Fill", icon: Stars, Comp: RarityReanalyzeTab },
      { id: "images", label: "Image Backfill", icon: ImageIcon, Comp: ImageBackfillTab },
    ],
  },
  {
    label: "Insights",
    tools: [
      { id: "vintage", label: "Vintage Audit", icon: Sparkles, Comp: VintageAuditTab },
      { id: "completion", label: "Set Completion", icon: ListChecks, Comp: SetCompletionTab },
      { id: "grade", label: "Grade Estimate", icon: Award, Comp: GradeEstimateBackfillTab },
    ],
  },
];

const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

export default function BulkToolsPage() {
  const [active, setActive] = useState<string>("tcg");
  const Active = ALL_TOOLS.find((t) => t.id === active)?.Comp || TCGPlayerEnrichTab;

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Bulk Tools</h1>
        <p className="text-sm text-muted-foreground">
          Sweep your collection: refresh prices, find duplicates, fill gaps, audit completeness.
        </p>
      </header>

      {/* Mobile picker */}
      <div className="md:hidden">
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TOOL_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{group.label}</div>
                {group.tools.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="hidden space-y-4 md:block">
          {TOOL_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
              <div className="space-y-1">
                {group.tools.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActive(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active === t.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-foreground/80"
                      )}
                    >
                      <Icon className="h-4 w-4" /> {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        <main className="min-w-0">
          <Active />
        </main>
      </div>
    </div>
  );
}
