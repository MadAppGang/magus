/**
 * Utilities for parsing and validating skill files
 */

import { readdir, readFile } from "fs/promises";
import { join, basename } from "path";
import YAML from "yaml";

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  tags: string[];
  keywords: string[];
  plugin: string;
  updated: string;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  content: string;
  path: string;
  name: string;
}

/**
 * Parse YAML frontmatter from a skill file
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("No frontmatter found in skill file");
  }
  return YAML.parse(match[1]) as SkillFrontmatter;
}

/**
 * Parse a complete skill file
 */
export function parseSkill(content: string, path: string): ParsedSkill {
  const frontmatter = parseSkillFrontmatter(content);
  const contentStart = content.indexOf("---", 4) + 3;
  return {
    frontmatter,
    content: content.slice(contentStart).trim(),
    path,
    name: basename(path.replace("/SKILL.md", "")),
  };
}

/**
 * Load all skills from a plugin directory
 */
export async function loadPluginSkills(
  pluginDir: string
): Promise<ParsedSkill[]> {
  const skillsDir = join(pluginDir, "skills");
  const skills: ParsedSkill[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(skillsDir, entry.name, "SKILL.md");
        try {
          const content = await readFile(skillPath, "utf-8");
          skills.push(parseSkill(content, skillPath));
        } catch (e) {
          // Skill file doesn't exist, skip
        }
      }
    }
  } catch (e) {
    // Skills directory doesn't exist
  }

  return skills;
}

/**
 * Validate skill frontmatter has all required fields
 */
export function validateFrontmatter(
  skill: ParsedSkill
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!skill.frontmatter.name) {
    errors.push("Missing required field: name");
  }
  if (!skill.frontmatter.description) {
    errors.push("Missing required field: description");
  }
  if (!skill.frontmatter.version) {
    errors.push("Missing required field: version");
  }
  if (!skill.frontmatter.plugin) {
    errors.push("Missing required field: plugin");
  }
  if (!Array.isArray(skill.frontmatter.tags)) {
    errors.push("Missing or invalid field: tags (must be array)");
  }
  if (!Array.isArray(skill.frontmatter.keywords)) {
    errors.push("Missing or invalid field: keywords (must be array)");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if skill content contains a specific section
 */
export function hasSection(skill: ParsedSkill, sectionName: string): boolean {
  const pattern = new RegExp(`^##\\s+${sectionName}`, "m");
  return pattern.test(skill.content);
}

/**
 * Check if skill content contains code blocks
 */
export function hasCodeBlocks(skill: ParsedSkill, language?: string): boolean {
  if (language) {
    return skill.content.includes("```" + language);
  }
  return skill.content.includes("```");
}

/**
 * Extract all code blocks from skill content
 */
export function extractCodeBlocks(
  skill: ParsedSkill
): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = [];
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(skill.content)) !== null) {
    blocks.push({
      language: match[1] || "text",
      code: match[2].trim(),
    });
  }

  return blocks;
}

/**
 * Check if skill content contains a table
 */
export function hasTables(skill: ParsedSkill): boolean {
  // Markdown table pattern: starts with |, has at least 2 rows
  return /\|.+\|[\s\S]*?\|.+\|/.test(skill.content);
}

/**
 * Get word count of skill content
 */
export function getWordCount(skill: ParsedSkill): number {
  return skill.content.split(/\s+/).filter((w) => w.length > 0).length;
}
