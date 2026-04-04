import type { SkillSource, StarReliability } from "../types/index.js";

export interface RecommendedSkill {
	name: string;
	repo: string;
	skillPath: string;
	description: string;
	category: string;
	stars?: number; // fallback when GitHub API is rate-limited
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
	{
		name: "Find Skills",
		repo: "vercel-labs/skills",
		skillPath: "skills/find-skills",
		description: "Discover and install new skills from the ecosystem",
		category: "search",
		stars: 12000,
	},
	{
		name: "React Best Practices",
		repo: "vercel-labs/agent-skills",
		skillPath: "skills/react-best-practices",
		description: "Modern React patterns and Vercel deployment guidelines",
		category: "frontend",
		stars: 24000,
	},
	{
		name: "Web Design Guidelines",
		repo: "vercel-labs/agent-skills",
		skillPath: "skills/web-design-guidelines",
		description: "UI/UX design principles and web standards",
		category: "design",
		stars: 24000,
	},
	{
		name: "Remotion Best Practices",
		repo: "remotion-dev/skills",
		skillPath: "skills/remotion-best-practices",
		description: "Programmatic video creation with Remotion",
		category: "media",
		stars: 2400,
	},
	{
		name: "UI/UX Pro Max",
		repo: "jh941213/my-claude-code-asset",
		skillPath: "skills_en/ui-ux-pro-max",
		description: "50 styles, 21 palettes, 50 font pairings, 9 stacks. Covers React, Next.js, Vue, Svelte, SwiftUI, Flutter, Tailwind, shadcn/ui",
		category: "design",
		stars: 109,
	},
	{
		name: "ElevenLabs TTS",
		repo: "inferen-sh/skills",
		skillPath: "skills/elevenlabs-tts",
		description: "Text-to-speech with ElevenLabs API integration",
		category: "media",
		stars: 206,
	},
	{
		name: "Audit Website",
		repo: "squirrelscan/skills",
		skillPath: "skills/audit-website",
		description: "Security and quality auditing for web applications",
		category: "security",
		stars: 67,
	},
	{
		name: "Systematic Debugging",
		repo: "obra/superpowers",
		skillPath: "skills/systematic-debugging",
		description: "Structured debugging methodology with root cause analysis",
		category: "debugging",
		stars: 113000,
	},
	{
		name: "shadcn/ui",
		repo: "shadcn-ui/ui",
		skillPath: "packages/shadcn",
		description: "shadcn/ui component library patterns and usage",
		category: "frontend",
		stars: 111000,
	},
	{
		name: "Neon Postgres",
		repo: "neondatabase/agent-skills",
		skillPath: "skills/neon-postgres",
		description: "Neon serverless Postgres setup and best practices",
		category: "database",
		stars: 42,
	},
	{
		name: "Neon Serverless",
		repo: "neondatabase/ai-rules",
		skillPath: "skills/neon-serverless",
		description: "Serverless database patterns with Neon",
		category: "database",
		stars: 81,
	},
];

// ─── Skill Sets (grouped skills from a single repo) ──────────────────────────

export interface RecommendedSkillSet {
  name: string;
  repo: string;
  description: string;
  icon: string;
  stars?: number;
}

export const RECOMMENDED_SKILL_SETS: RecommendedSkillSet[] = [
  {
    name: "Hugging Face",
    repo: "huggingface/skills",
    description: "Give your agents the power of the Hugging Face ecosystem",
    icon: "\u{1F917}",
    stars: 10000,
  },
];

// ─── Star reliability classification ────────────────────────────────────────
// Stars from these repos don't reflect individual skill quality.

/** Mega-repos: huge projects that happen to include skills. Stars are about the project. */
const MEGA_REPOS = new Set([
  "microsoft/vscode",
  "Significant-Gravitas/AutoGPT",
  "n8n-io/n8n",
  "anomalyco/opencode",
  "shadcn-ui/ui",
]);

/** Skill-dump repos: large collections where stars reflect quantity, not quality. */
const SKILL_DUMP_REPOS = new Set([
  "affaan-m/everything-claude-code",
  "openclaw/openclaw",
  "jh941213/my-claude-code-asset",
  "inferen-sh/skills",
]);

/**
 * Classify how reliable a repo's star count is as a quality signal for its skills.
 * - "dedicated": Stars reflect skill/repo quality (e.g. huggingface/skills, vercel-labs/agent-skills)
 * - "mega-repo": Stars are about a larger project, not the skills (e.g. microsoft/vscode)
 * - "skill-dump": Large skill collection — stars reflect popularity/quantity, not individual quality
 */
export function classifyStarReliability(repo: string, stars?: number): StarReliability {
  if (MEGA_REPOS.has(repo)) return "mega-repo";
  if (SKILL_DUMP_REPOS.has(repo)) return "skill-dump";
  // Heuristic: unknown repos with >50K stars are likely mega-repos
  if (stars && stars > 50000) return "mega-repo";
  return "dedicated";
}

export const STAR_RELIABILITY_INFO: Record<StarReliability, { label: string; description: string }> = {
  dedicated: {
    label: "Skill repo",
    description: "Stars reflect this skill repository's quality",
  },
  "mega-repo": {
    label: "Project repo",
    description: "Stars are for the parent project, not the skills. Skill quality may vary.",
  },
  "skill-dump": {
    label: "Skill collection",
    description: "Large skill collection — stars reflect repo popularity, not individual skill quality.",
  },
};

export const DEFAULT_SKILL_REPOS: SkillSource[] = [
	{
		label: "Vercel Agent Skills",
		repo: "vercel-labs/agent-skills",
		skillsPath: "skills",
	},
];
