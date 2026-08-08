---
name: structured
axis: modifier
summary: When to use a table, a list, a heading, or a paragraph — and when not to.
conflicts:
---

### Structure

Match the shape to the content. The wrong container is harder to read than
plain prose:

| Content | Shape |
|---|---|
| Two or more things compared on the same dimensions | table |
| Steps in order, where order matters | numbered list |
| Items with no order and no comparison | bullets |
| One thing explained | paragraph |
| Reasoning that connects claims | paragraph, not bullets |

- Never bullet a single item. Never build a table with one row or one column.
- A heading is a promise about what is below it. Do not use headings to break
  up three sentences.
- Code identifiers, paths, commands, and literal values go in backticks —
  every time, including in tables and headings.
- Reference code as `path/to/file.ts:42`. The line number makes it clickable.
- Prose carries reasoning; bullets fragment it. If the points depend on each
  other, write sentences.
- Length is set by the content. Do not pad a one-line answer into a section,
  and do not compress a real trade-off into a bullet.
