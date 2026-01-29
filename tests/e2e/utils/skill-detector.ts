/**
 * Skill detection and validation for E2E tests
 * Parses Claude Code responses to identify which skills were activated
 */

export interface SkillDetection {
  detected: string[]; // Skills actually used
  expected: string[]; // Skills that should have been used
  unexpected: string[]; // Skills that shouldn't have been used
  missing: string[]; // Expected skills not detected
  matchRatio: number; // 0-1 ratio of correct detections
}

export class SkillDetector {
  /**
   * Detect which skills were activated in Claude Code response
   *
   * Detection strategies:
   * 1. Explicit markers: "Using skill: skill-name"
   * 2. Read tool calls: Reading from skills directory SKILL.md files
   * 3. Content analysis: Matching skill patterns and keywords
   */
  detect(response: string): string[] {
    const skills = new Set<string>();

    // Strategy 1: Explicit skill markers
    const markerPattern = /Using skill:\s*([a-z0-9-]+)/gi;
    let match;
    while ((match = markerPattern.exec(response)) !== null) {
      skills.add(match[1]);
    }

    // Strategy 2: Read tool calls (skill file paths)
    const readPattern = /Read.*?skills\/([^/]+)\/SKILL\.md/gi;
    while ((match = readPattern.exec(response)) !== null) {
      skills.add(match[1]);
    }

    // Strategy 3: File path mentions in responses
    const pathPattern = /(?:plugins\/[^/]+\/)?skills\/([a-z0-9-]+)/gi;
    while ((match = pathPattern.exec(response)) !== null) {
      skills.add(match[1]);
    }

    return Array.from(skills);
  }

  /**
   * Compare detected skills against expectations
   */
  compare(
    detected: string[],
    required: string[],
    optional: string[] = [],
    forbidden: string[] = []
  ): SkillDetection {
    const detectedSet = new Set(detected);
    const requiredSet = new Set(required);
    const forbiddenSet = new Set(forbidden);

    const missing = required.filter((s) => !detectedSet.has(s));
    const unexpected = detected.filter((s) => forbiddenSet.has(s));

    // Calculate match ratio
    const requiredMatches = required.filter((s) => detectedSet.has(s)).length;
    const forbiddenViolations = unexpected.length;
    const matchRatio =
      required.length > 0
        ? (requiredMatches - forbiddenViolations) / required.length
        : 1.0;

    return {
      detected,
      expected: required,
      unexpected,
      missing,
      matchRatio: Math.max(0, matchRatio),
    };
  }

  /**
   * Extract skill content from response
   * Useful for validating that skill guidance was followed
   */
  extractSkillContent(response: string, skillName: string): string | null {
    // Look for sections that reference the skill
    const pattern = new RegExp(
      `(?:Using|Following|As per)\\s+${skillName}\\s+skill[:\\s]([\\s\\S]*?)(?=\\n\\n|$)`,
      "i"
    );
    const match = response.match(pattern);
    return match ? match[1].trim() : null;
  }
}
