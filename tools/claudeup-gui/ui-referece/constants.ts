import { Plugin, Marketplace, Project } from './types';

export const MOCK_PROJECTS: Project[] = [
  { id: 'proj_1', name: 'claude-plugin-manager', path: '~/dev/claude-plugin-manager', lastOpened: 'Just now' },
  { id: 'proj_2', name: 'ecommerce-dashboard', path: '~/work/clients/dashboard', lastOpened: '2 hours ago' },
  { id: 'proj_3', name: 'personal-portfolio', path: '~/personal/site-v2', lastOpened: '1 day ago' },
];

export const MOCK_MARKETPLACES: Marketplace[] = [
  { id: 'mag-claude-plugins', name: 'MAG Claude Plugins', count: '12 plugins', icon: 'package' },
  { id: 'community', name: 'Community Registry', count: '189 plugins', icon: 'globe' },
  { id: 'official', name: 'Official Plugins', count: '45 plugins', icon: 'chrome' },
];

export const MOCK_PLUGINS: Plugin[] = [
  {
    id: "dev@mag-claude-plugins",
    name: "dev",
    version: "1.17.0",
    description: "Universal development assistant with self-improving learning, documentation, deep research, specification interviews, and DevOps guidance. v1.17.0: Dingo skill auto-detection - agents now auto-load dingo+golang skills when .dingo files detected. 30+ skills.",
    marketplace: "mag-claude-plugins",
    marketplaceDisplay: "MAG Claude Plugins",
    enabled: true,
    hasUpdate: false,
    installedVersion: "1.17.0",
    category: "development",
    author: {
      name: "Jack Rudenko",
      email: "i@madappgang.com",
      company: "MadAppGang"
    },
    keywords: ["development", "universal", "deep-research", "devops", "react", "typescript", "golang", "python", "rust"],
    agents: [
      { name: "stack-detector", description: "Identifies project technology stack and configures appropriate tools." },
      { name: "developer", description: "General purpose coding agent for implementing features and fixing bugs." },
      { name: "debugger", description: "Specialized agent for analyzing error logs and fixing runtime issues." },
      { name: "architect", description: "High-level system design and structural planning agent." },
      { name: "ui", description: "Frontend specialist focused on CSS, layout, and component libraries." },
      { name: "scribe", description: "Documentation and note-taking agent." },
      { name: "spec-writer", description: "Creates detailed technical specifications from requirements." },
      { name: "devops", description: "Handles CI/CD pipelines, Docker configurations, and deployment." },
      { name: "researcher", description: "Deep search and analysis of external documentation." },
      { name: "synthesizer", description: "Combines information from multiple sources into a coherent summary." },
      { name: "doc-writer", description: "Generates user-facing documentation." },
      { name: "doc-analyzer", description: "Reviews documentation for accuracy and completeness." },
      { name: "doc-fixer", description: "Automatically corrects outdated or incorrect documentation." }
    ],
    commands: [
      { name: "/dev:help", description: "Shows available commands and usage examples." },
      { name: "/dev:implement", description: "Implements a feature based on a description." },
      { name: "/dev:debug", description: "Starts a debugging session for a specific issue." },
      { name: "/dev:feature", description: "Scaffolds a new feature with tests and documentation." },
      { name: "/dev:architect", description: "Generates architecture diagrams and decision records." },
      { name: "/dev:ui", description: "Generates or updates UI components." },
      { name: "/dev:create-style", description: "Creates a new style guide or theme." },
      { name: "/dev:interview", description: "Conducts a requirements gathering interview." },
      { name: "/dev:deep-research", description: "Performs extensive research on a topic." },
      { name: "/dev:doc", description: "Generates documentation for the current file or module." },
      { name: "/dev:learn", description: "Analyzes the codebase to improve context understanding." }
    ],
    skills: [
      { name: "context-detection", description: "Analyzes file structure to understand project context." },
      { name: "react-typescript", description: "Expertise in React 18+ and TypeScript patterns." },
      { name: "vue-typescript", description: "Expertise in Vue 3 and TypeScript." },
      { name: "golang", description: "Backend development with Go." },
      { name: "dingo", description: "Support for the Dingo framework." },
      { name: "bunjs", description: "Bun runtime optimization and tooling." },
      { name: "python", description: "Python scripting and data processing." },
      { name: "rust", description: "Systems programming with Rust." },
      { name: "ui-design-review", description: "Evaluates UI against design principles." }
    ],
    userScope: { enabled: true, version: "1.17.0" },
    projectScope: { enabled: false },
    localScope: null
  },
  {
    id: "nanobanana@mag-claude-plugins",
    name: "nanobanana",
    version: "2.2.3",
    description: "AI image generation and editing using Google Gemini 3 Pro Image API (Nano Banana Pro). Simple Node.js CLI with markdown styles, batch generation, reference image support, and comprehensive error handling with retry logic.",
    marketplace: "mag-claude-plugins",
    marketplaceDisplay: "MAG Claude Plugins",
    enabled: false,
    hasUpdate: true,
    installedVersion: "2.1.0",
    category: "media",
    author: {
      name: "Jack Rudenko",
      company: "MadAppGang"
    },
    keywords: ["image-generation", "ai-art", "gemini", "text-to-image"],
    agents: [],
    commands: [
      { name: "/nanobanana:generate", description: "Generates an image from a text prompt." },
      { name: "/nanobanana:edit", description: "Edits an existing image using a mask and prompt." }
    ],
    skills: [
      { name: "image-prompts", description: "Optimizes prompts for image generation models." },
      { name: "style-transfer", description: "Applies artistic styles to images." }
    ],
    userScope: { enabled: false, version: "2.1.0" },
    projectScope: null,
    localScope: null
  },
  {
    id: "code-analysis@mag-claude-plugins",
    name: "code-analysis",
    version: "3.0.0",
    description: "Deep code investigation with claudemem. v3.0.0: ENRICHMENT MODE - hooks now enhance native tools with AST context instead of blocking.",
    marketplace: "mag-claude-plugins",
    marketplaceDisplay: "MAG Claude Plugins",
    enabled: true,
    hasUpdate: false,
    installedVersion: "3.0.0",
    category: "development",
    author: {
      name: "Jack Rudenko"
    },
    keywords: ["code-analysis", "semantic-search", "claudemem", "debugging"],
    agents: [
      { name: "codebase-detective", description: "Crawls codebase to build dependency graphs." }
    ],
    commands: [
      { name: "/code-analysis:analyze", description: "Performs a deep static analysis of the selected files." },
      { name: "/code-analysis:help", description: "Shows help for code analysis tools." },
      { name: "/code-analysis:setup", description: "Initializes analysis configuration." }
    ],
    skills: [
      { name: "deep-analysis", description: "AST-based code analysis." },
      { name: "claudemem-search", description: "Semantic search over project history." },
      { name: "architect-detective", description: "Identifies architectural patterns and violations." },
      { name: "developer-detective", description: "Tracks code ownership and churn." },
      { name: "ultrathink-detective", description: "Advanced reasoning for complex bugs." }
    ],
    hooks: "./hooks/hooks.json",
    userScope: { enabled: true, version: "3.0.0" },
    projectScope: { enabled: true, version: "3.0.0" },
    localScope: null
  },
  {
    id: "conductor@mag-claude-plugins",
    name: "conductor",
    version: "1.0.5",
    description: "Workflow orchestration and task management for complex multi-agent systems.",
    marketplace: "mag-claude-plugins",
    marketplaceDisplay: "MAG Claude Plugins",
    enabled: true,
    hasUpdate: false,
    installedVersion: "1.0.5",
    category: "workflow",
    author: {
      name: "MadAppGang Team"
    },
    keywords: ["orchestration", "workflow", "tasks", "automation"],
    agents: [
      { name: "task-master", description: "Assigns tasks to other agents." },
      { name: "scheduler", description: "Manages task timing and dependencies." }
    ],
    commands: [
      { name: "/conductor:start", description: "Starts a defined workflow." },
      { name: "/conductor:status", description: "Shows status of active workflows." }
    ],
    skills: [
      { name: "task-graph", description: "Builds DAGs of task dependencies." },
      { name: "dependency-resolution", description: "Resolves blocking dependencies between tasks." }
    ],
    userScope: { enabled: true, version: "1.0.5" },
    projectScope: null,
    localScope: null
  },
  {
    id: "seo-wizard@community",
    name: "seo-wizard",
    version: "4.2.0",
    description: "Advanced content optimization and keyword research tool integrated directly into your writing workflow.",
    marketplace: "community",
    marketplaceDisplay: "Community Registry",
    enabled: false,
    installedVersion: undefined,
    category: "content",
    author: {
      name: "ContentAI"
    },
    keywords: ["seo", "content", "optimization", "writing"],
    agents: [
      { name: "content-auditor", description: "Reviews text for SEO best practices." }
    ],
    commands: [
      { name: "/seo:audit", description: "Audits the current file for SEO score." },
      { name: "/seo:keywords", description: "Suggests keywords based on content." }
    ],
    skills: [
      { name: "keyword-extraction", description: "Identifies key topics in text." },
      { name: "readability-analysis", description: "Scores text complexity and readability." }
    ],
    userScope: null,
    projectScope: null,
    localScope: null
  }
];