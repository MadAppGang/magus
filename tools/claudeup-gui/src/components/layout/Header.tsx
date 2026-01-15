import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function Header() {
  return (
    <header className="border-b bg-background px-6 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">claudeup</h1>
          <p className="text-xs text-muted-foreground">Claude Code Plugin Manager</p>
        </div>

        <div className="flex items-center gap-4">
          <Select>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select project..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global Settings</SelectItem>
              <SelectItem value="current">Current Project</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
