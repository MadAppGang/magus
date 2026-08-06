# Project Context

A Bun/TypeScript authentication service.

## Mandatory reading before writing auth code

This project keeps its security policy in a skill file. It carries
`disable-model-invocation`, so it never appears in your skill listing and the Skill
tool will not surface it.

**Before writing any authentication, password, token or rate-limiting code, read
`.claude/skills/security/SKILL.md` with the Read tool**, then follow it — including
copying `.claude/skills/security/assets/security/` into `src/` rather than retyping
its logic.

This is not optional. Code written without reading it has repeatedly shipped
timing oracles and weak password storage.
