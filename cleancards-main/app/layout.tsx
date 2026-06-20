export const metadata = {
  title: "Mint Condition Market",
  description: "Advanced trading card collection manager",
  manifest: "/manifest.json"
};

export default function RootLayout({ children }) {
  return (
    <html>
      <body style={{ background: "#0a0a0a", color: "white" }}>
        {children}
      </body>
    </html>
  );
}