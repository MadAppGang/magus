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
		skillPath: "find-skills",
		description: "Discover and install new skills from the ecosystem",
		category: "search",
	},
	{
		name: "React Best Practices",
		repo: "vercel-labs/agent-skills",
		skillPath: "vercel-react-best-practices",
		description: "Modern React patterns and Vercel deployment guidelines",
		category: "frontend",
	},
	{
		name: "Web Design Guidelines",
		repo: "vercel-labs/agent-skills",
		skillPath: "web-design-guidelines",
		description: "UI/UX design principles and web standards",
		category: "design",
	},
	{
		name: "Remotion Best Practices",
		repo: "remotion-dev/skills",
		skillPath: "remotion-best-practices",
		description: "Programmatic video creation with Remotion",
		category: "media",
	},
	{
		name: "UI/UX Pro Max",
		repo: "nextlevelbuilder/ui-ux-pro-max-skill",
		skillPath: "ui-ux-pro-max",
		description: "Advanced UI/UX design and implementation patterns",
		category: "design",
	},
	{
		name: "ElevenLabs TTS",
		repo: "inferen-sh/skills",
		skillPath: "elevenlabs-tts",
		description: "Text-to-speech with ElevenLabs API integration",
		category: "media",
	},
	{
		name: "Audit Website",
		repo: "squirrelscan/skills",
		skillPath: "audit-website",
		description: "Security and quality auditing for web applications",
		category: "security",
	},
	{
		name: "Systematic Debugging",
		repo: "obra/superpowers",
		skillPath: "systematic-debugging",
		description: "Structured debugging methodology with root cause analysis",
		category: "debugging",
	},
	{
		name: "shadcn/ui",
		repo: "shadcn/ui",
		skillPath: "shadcn",
		description: "shadcn/ui component library patterns and usage",
		category: "frontend",
	},
	{
		name: "Neon Postgres",
		repo: "neondatabase/agent-skills",
		skillPath: "neon-postgres",
		description: "Neon serverless Postgres setup and best practices",
		category: "database",
	},
	{
		name: "Neon Serverless",
		repo: "neondatabase/ai-rules",
		skillPath: "neon-serverless",
		description: "Serverless database patterns with Neon",
		category: "database",
	},
];

export const DEFAULT_SKILL_REPOS: SkillSource[] = [
	{
		label: "vercel-labs/agent-skills",
		repo: "vercel-labs/agent-skills",
		skillsPath: "skills",
	},
];
