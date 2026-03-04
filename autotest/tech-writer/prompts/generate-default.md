Write comprehensive technical documentation about how skill injection works in the dev plugin's `/dev:implement` command.

The documentation should cover:

1. What skills are and how they're discovered (SKILL.md files, frontmatter parsing)
2. How the Skill tool invocation works — what happens when a skill is loaded
3. How content gets injected into the conversation context
4. How `/dev:implement` chains multiple skills (brainstorming → planning → execution)
5. The lifecycle of a skill invocation from trigger to completion

The target audience is a Claude Code plugin developer who wants to understand the skill system to build their own skills.

Include:
- Code examples showing skill file structure
- Diagrams illustrating the injection flow
- A quick-start section for creating a basic skill
- Reference information for the SKILL.md frontmatter schema

The documentation should be thorough enough to serve as the definitive guide for the skill injection system.
