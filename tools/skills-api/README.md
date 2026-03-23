# Skills API

Firebase Cloud Function that aggregates multiple skill sources (SkillsMP API, GitHub Tree API) behind a single endpoint, keeping API keys server-side.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SKILLSMP_API_KEY` | Yes | SkillsMP API key for keyword and AI search |
| `GITHUB_TOKEN` | No | GitHub personal access token — raises rate limit from 60 to 5000 req/hr |

API keys are stored in Firebase environment config and never exposed to clients.

## Local Development

```bash
npm run serve
```

Starts the Firebase emulator at `http://localhost:5001`.

## Deploy

```bash
npm run deploy
```

Deploys to Firebase Cloud Functions (`us-central1`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills/search?q=react&page=1&limit=20` | Keyword + AI search via SkillsMP |
| `GET` | `/skills/repo/{owner}/{repo}` | List all skills in a GitHub repo (5-min cache) |
| `GET` | `/skills/recommended` | Curated list of recommended skills |

### `/skills/search`

Query parameters:

- `q` (required) — search query; if more than 3 words, also triggers AI search
- `page` (default: 1)
- `limit` (default: 20)

### `/skills/repo/{owner}/{repo}`

Uses the GitHub Tree API to find all `SKILL.md` files. Results are cached for 5 minutes using ETags.

### `/skills/recommended`

Returns a hardcoded curated list of 11 recommended skills across categories: search, frontend, backend, languages, testing, tooling, devops, code-analysis, and database.
