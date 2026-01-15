import { Button } from "../ui/button";

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { id: "plugins", label: "Plugins", icon: "🔌" },
  { id: "mcp", label: "MCP Servers", icon: "🛠️" },
  { id: "registry", label: "MCP Registry", icon: "📦" },
  { id: "statusline", label: "Status Line", icon: "📊" },
  { id: "envvars", label: "Environment Vars", icon: "🔐" },
  { id: "cli-tools", label: "CLI Tools", icon: "⚙️" },
  { id: "models", label: "Model Selector", icon: "🤖" },
];

interface SidebarProps {
  currentScreen: string;
  onScreenChange: (screen: string) => void;
}

export function Sidebar({ currentScreen, onScreenChange }: SidebarProps) {
  return (
    <aside className="w-64 border-r bg-background p-4">
      <nav className="space-y-1">
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant={currentScreen === item.id ? "default" : "ghost"}
            className="w-full justify-start"
            onClick={() => onScreenChange(item.id)}
          >
            <span className="mr-2">{item.icon}</span>
            {item.label}
          </Button>
        ))}
      </nav>
    </aside>
  );
}
