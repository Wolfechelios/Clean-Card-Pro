import { NavBar } from "./NavBar";
import { SideBar } from "./SideBar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-black text-white">
      <NavBar />
      <div className="flex">
        <SideBar />
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
