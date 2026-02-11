import { ChevronRight, Home } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NAV_FLAT } from "@/lib/navigation";

function findLabel(pathname: string) {
  return NAV_FLAT.find((i) => i.path === pathname)?.label;
}

export function Breadcrumbs() {
  const { pathname } = useLocation();

  // Only show crumbs for known routes
  const current = findLabel(pathname);
  if (!current || pathname === "/dashboard") return null;

  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
      <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Dashboard</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="text-foreground/90 font-medium">{current}</span>
    </div>
  );
}
