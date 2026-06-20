// FoilIssueTagPicker — lets user select issue tags for a foil scan

import { Badge } from "@/components/ui/badge";
import { FOIL_ISSUE_TAGS, type FoilIssueTag } from "@/lib/foilTrainer/types";
import { cn } from "@/lib/utils";

interface FoilIssueTagPickerProps {
  selected: FoilIssueTag[];
  onChange: (tags: FoilIssueTag[]) => void;
}

export function FoilIssueTagPicker({ selected, onChange }: FoilIssueTagPickerProps) {
  const toggle = (tag: FoilIssueTag) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {FOIL_ISSUE_TAGS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => toggle(value)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
            selected.includes(value)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary/50 text-muted-foreground border-border hover:bg-secondary",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
