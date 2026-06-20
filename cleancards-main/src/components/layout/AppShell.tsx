import { ReactNode } from "react";

interface AppShellProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export default function AppShell({
  header,
  footer,
  children,
}: AppShellProps) {
  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      {/* Top HUD */}
      {header && (
        <header className="shrink-0 px-4 pt-3 pb-2 backdrop-blur-sm bg-neutral-950/70 border-b border-neutral-800">
          {header}
        </header>
      )}

      {/* Main Stage */}
      <main className="flex-1 relative overflow-hidden">
        {children}
      </main>

      {/* Bottom Action Dock */}
      {footer && (
        <footer className="shrink-0 px-4 py-3 bg-neutral-950/85 backdrop-blur-md border-t border-neutral-800">
          {footer}
        </footer>
      )}
    </div>
  );
}
