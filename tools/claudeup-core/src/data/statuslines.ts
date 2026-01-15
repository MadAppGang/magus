export interface StatusLine {
  name: string;
  description: string;
  command: string;
  category: "git" | "system" | "time" | "custom";
  requiresConfig?: boolean;
  documentation?: string;
}

export const STATUS_LINES: StatusLine[] = [
  {
    name: "git-branch",
    description: "Current git branch",
    command: "git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'no-git'",
    category: "git",
  },
  {
    name: "git-status",
    description: "Git status (clean/dirty)",
    command: "git status --porcelain 2>/dev/null | wc -l | xargs -I {} bash -c 'if [ {} -eq 0 ]; then echo \"clean\"; else echo \"dirty\"; fi'",
    category: "git",
  },
  {
    name: "current-time",
    description: "Current time (HH:MM)",
    command: "date '+%H:%M'",
    category: "time",
  },
  {
    name: "current-date",
    description: "Current date (YYYY-MM-DD)",
    command: "date '+%Y-%m-%d'",
    category: "time",
  },
  {
    name: "pwd",
    description: "Current working directory",
    command: "pwd",
    category: "system",
  },
  {
    name: "user",
    description: "Current user",
    command: "whoami",
    category: "system",
  },
  {
    name: "hostname",
    description: "System hostname",
    command: "hostname",
    category: "system",
  },
];
