export interface McpServer {
  name: string;
  description: string;
  // For stdio-based servers
  command?: string;
  args?: string[];
  // For HTTP-based servers (like Figma's remote server)
  url?: string;
  transport?: "stdio" | "http";
  env?: Record<string, string>;
  // List of required environment variable names
  requiredEnv?: string[];
  category: "filesystem" | "database" | "api" | "productivity" | "development" | "other";
  requiresConfig?: boolean;
  installCommand?: string;
  documentation?: string;
  docsUrl?: string;
}

export const MCP_SERVERS: McpServer[] = [
  {
    name: "filesystem",
    description: "File system operations",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
    transport: "stdio",
    category: "filesystem",
    requiresConfig: true,
    documentation: "Configure allowed directory paths",
  },
  {
    name: "github",
    description: "GitHub repository access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    transport: "stdio",
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: "your-token-here",
    },
    requiredEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    category: "development",
    requiresConfig: true,
    documentation: "Requires GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  {
    name: "postgres",
    description: "PostgreSQL database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    transport: "stdio",
    category: "database",
    requiresConfig: true,
    documentation: "Configure database connection string",
  },
  {
    name: "sqlite",
    description: "SQLite database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/database.db"],
    transport: "stdio",
    category: "database",
    requiresConfig: true,
    documentation: "Configure database file path",
  },
  {
    name: "slack",
    description: "Slack workspace integration",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    transport: "stdio",
    env: {
      SLACK_BOT_TOKEN: "xoxb-your-token",
      SLACK_TEAM_ID: "T1234567890",
    },
    requiredEnv: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    category: "productivity",
    requiresConfig: true,
    documentation: "Requires SLACK_BOT_TOKEN and SLACK_TEAM_ID",
  },
  {
    name: "google-drive",
    description: "Google Drive access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    transport: "stdio",
    category: "productivity",
    requiresConfig: true,
    documentation: "Requires Google OAuth credentials",
  },
  {
    name: "puppeteer",
    description: "Browser automation",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    transport: "stdio",
    category: "development",
    requiresConfig: false,
  },
  {
    name: "brave-search",
    description: "Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    transport: "stdio",
    env: {
      BRAVE_API_KEY: "your-api-key",
    },
    requiredEnv: ["BRAVE_API_KEY"],
    category: "api",
    requiresConfig: true,
    documentation: "Requires BRAVE_API_KEY",
  },
  {
    name: "memory",
    description: "Persistent memory storage",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    transport: "stdio",
    category: "other",
    requiresConfig: false,
  },
  {
    name: "figma",
    description: "Official Figma MCP - generate code from designs, extract variables and components",
    url: "https://mcp.figma.com/mcp",
    transport: "http",
    env: {
      FIGMA_PERSONAL_ACCESS_TOKEN: "your-figma-token",
    },
    requiredEnv: ["FIGMA_PERSONAL_ACCESS_TOKEN"],
    category: "development",
    requiresConfig: true,
    documentation: "Requires FIGMA_PERSONAL_ACCESS_TOKEN from Figma account settings",
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server",
  },
  {
    name: "firecrawl",
    description: "Web scraping and crawling API",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    transport: "stdio",
    env: {
      FIRECRAWL_API_KEY: "your-api-key",
    },
    requiredEnv: ["FIRECRAWL_API_KEY"],
    category: "api",
    requiresConfig: true,
    documentation: "Requires FIRECRAWL_API_KEY",
    docsUrl: "https://docs.firecrawl.dev/",
  },
  {
    name: "claudemem",
    description: "Semantic code search with AST analysis - indexes your codebase for intelligent search",
    command: "npx",
    args: ["-y", "claude-codemem", "--mcp"],
    transport: "stdio",
    category: "development",
    requiresConfig: false,
    documentation: "Provides semantic code search, symbol lookup, callers/callees analysis",
    docsUrl: "https://github.com/MadAppGang/claudemem",
  },
  {
    name: "claudish",
    description: "Run Claude Code with any AI model - OpenRouter, Gemini, OpenAI, Ollama, and more",
    command: "npx",
    args: ["-y", "claudish", "--mcp"],
    transport: "stdio",
    env: {
      OPENROUTER_API_KEY: "your-openrouter-key",
    },
    requiredEnv: ["OPENROUTER_API_KEY"],
    category: "development",
    requiresConfig: true,
    documentation: "Requires OPENROUTER_API_KEY for cloud models. Local models (Ollama, LM Studio) work without API key.",
    docsUrl: "https://github.com/MadAppGang/claudish",
  },
];
