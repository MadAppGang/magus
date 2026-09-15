---
description: firebase CLI reference for hosting, functions, Firestore and preview channels, plus a worked multi-environment hosting setup. Read when the target platform is Firebase — `dev:devops` routes here by path.
---

# Firebase

Reference for `dev:devops`. Read when the workload targets Firebase. Every command is a proposal for the caller to run; the agent that reads this file generates, it does not apply. `firebase projects:list` is the read-only check the agent may run itself.

## firebase CLI

```bash
# Project setup
firebase login
firebase init
firebase use {project-id}
firebase projects:list          # read-only; safe to run

# Hosting
firebase deploy --only hosting
firebase hosting:channel:deploy {channel-name}
firebase hosting:channel:list

# Functions
firebase deploy --only functions
firebase functions:log

# Firestore
firebase firestore:indexes
firebase firestore:delete --all-collections   # destructive; never proposed without an explicit request

# Multi-site hosting
firebase target:apply hosting {target-name} {site-name}
firebase deploy --only hosting:{target-name}

# Preview channels (pull requests)
firebase hosting:channel:deploy pr-{number} --expires 7d
```

## Worked example: hosting for dev, staging and production

Request: "Configure Firebase hosting for dev, staging, and production."

Research: search "firebase multi-site hosting configuration" for the current year and "firebase hosting targets environments". Expected pattern: one Firebase project per environment, hosting targets mapped to sites.

CLI:

```bash
# 1. Create the projects (if they do not exist)
firebase projects:create myapp-dev
firebase projects:create myapp-staging
firebase projects:create myapp-prod

# 2. Declare hosting targets in firebase.json
cat > firebase.json <<'EOF'
{
  "hosting": [
    {
      "target": "dev",
      "public": "dist",
      "ignore": ["firebase.json", "**/.*"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }]
    },
    {
      "target": "staging",
      "public": "dist",
      "ignore": ["firebase.json", "**/.*"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }]
    },
    {
      "target": "prod",
      "public": "dist",
      "ignore": ["firebase.json", "**/.*"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }],
      "headers": [
        {
          "source": "**/*.@(js|css)",
          "headers": [{ "key": "Cache-Control", "value": "max-age=31536000" }]
        }
      ]
    }
  ]
}
EOF

# 3. Map targets to sites
firebase target:apply hosting dev myapp-dev
firebase target:apply hosting staging myapp-staging
firebase target:apply hosting prod myapp-prod

# 4. Deploy per environment
firebase use myapp-dev && firebase deploy --only hosting:dev
firebase use myapp-staging && firebase deploy --only hosting:staging
firebase use myapp-prod && firebase deploy --only hosting:prod

# 5. Preview channels for pull requests
firebase hosting:channel:deploy pr-123 --expires 7d --project myapp-staging
```

Cost estimate:

| Environment | Storage | Bandwidth | Monthly cost |
|-------------|---------|-----------|--------------|
| Dev | 1 GB | 10 GB | Free tier |
| Staging | 1 GB | 50 GB | Free tier |
| Production | 5 GB | 200 GB | ~$20 |
| **Total** | | | **~$20/month** |

The project ids above are illustrative. If the prompt did not establish the target projects and environments, the verdict is BLOCKED naming them; never substitute these placeholders.
