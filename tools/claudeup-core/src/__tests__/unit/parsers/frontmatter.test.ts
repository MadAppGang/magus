/**
 * Unit tests for YAML frontmatter parsing
 *
 * Tests cover:
 * - Valid frontmatter extraction
 * - Missing frontmatter detection
 * - Malformed YAML handling
 * - Edge cases (empty content, no body, etc.)
 */

import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../utils/parsers.js';

describe('parseFrontmatter', () => {
  describe('valid frontmatter', () => {
    it('should parse simple key-value frontmatter', () => {
      const content = `---
name: test-agent
description: A test agent
---

# Body content`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test-agent');
      expect(result!.frontmatter.description).toBe('A test agent');
      expect(result!.body).toBe('# Body content');
    });

    it('should parse quoted string values', () => {
      const content = `---
name: "quoted-name"
description: 'single quoted'
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('quoted-name');
      expect(result!.frontmatter.description).toBe('single quoted');
    });

    it('should parse boolean values', () => {
      const content = `---
enabled: true
disabled: false
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.enabled).toBe(true);
      expect(result!.frontmatter.disabled).toBe(false);
    });

    it('should parse numeric values', () => {
      const content = `---
timeout: 30
priority: 100
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.timeout).toBe(30);
      expect(result!.frontmatter.priority).toBe(100);
    });

    it('should parse array values', () => {
      const content = `---
name: test
prerequisites:
  - skill-one
  - skill-two
  - skill-three
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.prerequisites).toEqual(['skill-one', 'skill-two', 'skill-three']);
    });

    it('should handle frontmatter with complex description', () => {
      const content = `---
name: test-agent
description: A detailed description with special chars: colons, (parens), and "quotes"
tools: Read, Write, Edit
---

Body content here`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test-agent');
      expect(result!.frontmatter.tools).toBe('Read, Write, Edit');
    });

    it('should handle Windows-style line endings (CRLF)', () => {
      const content = '---\r\nname: test\r\n---\r\n\r\nBody';

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test');
      expect(result!.body).toBe('Body');
    });

    it('should handle empty body', () => {
      const content = `---
name: test
---

`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test');
      expect(result!.body).toBe('');
    });

    it('should skip comment lines in frontmatter', () => {
      const content = `---
# This is a comment
name: test
# Another comment
description: desc
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test');
      expect(result!.frontmatter.description).toBe('desc');
    });
  });

  describe('missing or invalid frontmatter', () => {
    it('should return null for content without frontmatter', () => {
      const content = `# Just a heading

Regular markdown content without frontmatter.`;

      const result = parseFrontmatter(content);
      expect(result).toBeNull();
    });

    it('should return null for content with incomplete frontmatter (no closing)', () => {
      const content = `---
name: test

# Body without closing ---`;

      const result = parseFrontmatter(content);
      expect(result).toBeNull();
    });

    it('should return null for empty content', () => {
      const result = parseFrontmatter('');
      expect(result).toBeNull();
    });

    it('should return null for content with only delimiters', () => {
      const content = `------

Some content`;

      const result = parseFrontmatter(content);
      expect(result).toBeNull();
    });

    it('should return null when frontmatter does not start at beginning', () => {
      const content = `Some text before
---
name: test
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle keys with hyphens', () => {
      const content = `---
allowed-tools: Read, Write
some-key: value
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter['allowed-tools']).toBe('Read, Write');
      expect(result!.frontmatter['some-key']).toBe('value');
    });

    it('should handle keys with underscores', () => {
      const content = `---
allowed_tools: Read
some_key: value
---

Body`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter['allowed_tools']).toBe('Read');
      expect(result!.frontmatter['some_key']).toBe('value');
    });

    it('should handle very long body content', () => {
      const longBody = 'x'.repeat(10000);
      const content = `---
name: test
---

${longBody}`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test');
      expect(result!.body.length).toBe(10000);
    });

    it('should handle frontmatter with --- in body', () => {
      const content = `---
name: test
---

Some content with --- in the middle

---

And a horizontal rule`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('test');
      expect(result!.body).toContain('---');
    });

    it('should trim body content', () => {
      const content = `---
name: test
---


   Body with whitespace

`;

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.body).toBe('Body with whitespace');
    });
  });
});
