export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // next-themes is installed, but keep this minimal and non-invasive.
  return <>{children}</>;
}
