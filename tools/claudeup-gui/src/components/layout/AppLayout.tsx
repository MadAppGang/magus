import { ReactNode } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";

interface AppLayoutProps {
  currentScreen: string;
  onScreenChange: (screen: string) => void;
  children: ReactNode;
}

export function AppLayout({ currentScreen, onScreenChange, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar currentScreen={currentScreen} onScreenChange={onScreenChange} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}
