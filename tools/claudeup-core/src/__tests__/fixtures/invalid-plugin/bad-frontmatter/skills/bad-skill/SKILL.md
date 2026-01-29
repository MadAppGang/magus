---
name: bad-skill
description: This skill has invalid YAML in frontmatter
allowed-tools: [invalid, array, syntax
prerequisites: not-an-array
---

# Bad Skill

This skill has malformed frontmatter that should fail parsing.

The YAML has:
- Unclosed array bracket
- Wrong type for prerequisites (should be array, not string)
