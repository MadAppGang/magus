---
name: terminology
axis: modifier
summary: Project vocabulary — one name per concept, filled in from the codebase during apply.
conflicts:
template: true
---

### Terminology

One concept, one name, everywhere: code, comments, commit messages, docs, and
conversation. A concept with two names reads as two concepts.

| Use | Not | Because |
|---|---|---|
| <!-- filled during /style:apply --> | | |

Rules that hold regardless of the table above:

- Use the domain's word, not the implementation's. If the business calls it a
  "booking", the code and the conversation say booking, even where the table
  is named `reservations`.
- Do not invent a synonym for a term the codebase already uses. Grep before
  naming anything new.
- When the code and the domain disagree on a name, say which you are using and
  which the reader will see in the file.
- Keep abbreviations out of names people say out loud. `usr`, `mgr`, and `cfg`
  save four characters and cost a re-read every time.
