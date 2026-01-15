export interface McpServer {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  category: "filesystem" | "database" | "api" | "productivity" | "development" | "other";
  requiresConfig?: boolean;
  installCommand?: string;
  documentation?: string;
}

export const MCP_SERVERS: McpServer[] = [
  {
    name: "filesystem",
    description: "File system operations",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
    category: "filesystem",
    requiresConfig: true,
    documentation: "Configure allowed directory paths",
  },
  {
    name: "github",
    description: "GitHub repository access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: "your-token-here",
    },
    category: "development",
    requiresConfig: true,
    documentation: "Requires GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  {
    name: "postgres",
    description: "PostgreSQL database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    category: "database",
    requiresConfig: true,
    documentation: "Configure database connection string",
  },
  {
    name: "sqlite",
    description: "SQLite database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/database.db"],
    category: "database",
    requiresConfig: true,
    documentation: "Configure database file path",
  },
  {
    name: "slack",
    description: "Slack workspace integration",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: {
      SLACK_BOT_TOKEN: "xoxb-your-token",
      SLACK_TEAM_ID: "T1234567890",
    },
    category: "productivity",
    requiresConfig: true,
    documentation: "Requires SLACK_BOT_TOKEN and SLACK_TEAM_ID",
  },
  {
    name: "google-drive",
    description: "Google Drive access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    category: "productivity",
    requiresConfig: true,
    documentation: "Requires Google OAuth credentials",
  },
  {
    name: "puppeteer",
    description: "Browser automation",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    category: "development",
    requiresConfig: false,
  },
  {
    name: "brave-search",
    description: "Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: {
      BRAVE_API_KEY: "your-api-key",
    },
    category: "api",
    requiresConfig: true,
    documentation: "Requires BRAVE_API_KEY",
  },
  {
    name: "memory",
    description: "Persistent memory storage",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    category: "other",
    requiresConfig: false,
  },
];
