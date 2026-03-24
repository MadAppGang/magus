import type { SkillSource } from "../types/index.js";

export interface RecommendedSkill {
	name: string;
	repo: string;
	skillPath: string;
	description: string;
	category: string;
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
	{
		name: "Find Skills",
		repo: "vercel-labs/skills",
		skillPath: "skills/find-skills",
		description: "Discover and install new skills from the ecosystem",
		category: "search",
	},
	{
		name: "React Best Practices",
		repo: "vercel-labs/agent-skills",
		skillPath: "skills/react-best-practices",
		description: "Modern React patterns and Vercel deployment guidelines",
		category: "frontend",
	},
	{
		name: "Web Design Guidelines",
		repo: "vercel-labs/agent-skills",
		skillPath: "skills/web-design-guidelines",
		description: "UI/UX design principles and web standards",
		category: "design",
	},
	{
		name: "Remotion Best Practices",
		repo: "remotion-dev/skills",
		skillPath: "skills/remotion-best-practices",
		description: "Programmatic video creation with Remotion",
		category: "media",
	},
	{
		name: "UI/UX Pro Max",
		repo: "jh941213/my-claude-code-asset",
		skillPath: "skills_en/ui-ux-pro-max",
		description: "50 styles, 21 palettes, 50 font pairings, 9 stacks. Covers React, Next.js, Vue, Svelte, SwiftUI, Flutter, Tailwind, shadcn/ui",
		category: "design",
	},
	{
		name: "ElevenLabs TTS",
		repo: "inferen-sh/skills",
		skillPath: "skills/elevenlabs-tts",
		description: "Text-to-speech with ElevenLabs API integration",
		category: "media",
	},
	{
		name: "Audit Website",
		repo: "squirrelscan/skills",
		skillPath: "skills/audit-website",
		description: "Security and quality auditing for web applications",
		category: "security",
	},
	{
		name: "Systematic Debugging",
		repo: "obra/superpowers",
		skillPath: "skills/systematic-debugging",
		description: "Structured debugging methodology with root cause analysis",
		category: "debugging",
	},
	{
		name: "shadcn/ui",
		repo: "shadcn-ui/ui",
		skillPath: "packages/shadcn",
		description: "shadcn/ui component library patterns and usage",
		category: "frontend",
	},
	{
		name: "Neon Postgres",
		repo: "neondatabase/agent-skills",
		skillPath: "skills/neon-postgres",
		description: "Neon serverless Postgres setup and best practices",
		category: "database",
	},
	{
		name: "Neon Serverless",
		repo: "neondatabase/ai-rules",
		skillPath: "skills/neon-serverless",
		description: "Serverless database patterns with Neon",
		category: "database",
	},
];

export const DEFAULT_SKILL_REPOS: SkillSource[] = [
	{
		label: "Vercel Agent Skills",
		repo: "vercel-labs/agent-skills",
		skillsPath: "skills",
	},
];
