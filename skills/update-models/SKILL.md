---
name: update-models
description: Sync model aliases from the curated Firebase database. Fetches default model assignments, short aliases, team compositions, and known model metadata from the claudish API. Run this to get fresh model recommendations.
---

## Update Models

Fetch the latest model defaults from the claudish curated database and save locally.

### Steps

1. **Fetch from API:**
   ```bash
   curl -s "https://us-central1-claudish-6da10.cloudfunctions.net/queryPluginDefaults?resolve=true"
   ```

2. **Validate response:**
   - Must be valid JSON
   - Must have `version`, `shortAliases`, `roles`, `teams`, `knownModels` fields
   - `knownModels` must have at least 5 entries
   - Check for `warnings` array — report any missing models

3. **Compare with current:**
   - Read `shared/model-aliases.json` (if exists)
   - Compare `version` field — if same, report "Already up to date" and stop
   - Diff `shortAliases` — report changed aliases
   - Diff `roles` — report changed role assignments
   - Diff `teams` — report changed team compositions
   - Report new/removed models in `knownModels`

4. **Write to `shared/model-aliases.json`:**
   - Pretty-print the JSON (2-space indent)
   - Use the Write tool to save

5. **Report summary:**
   ```
   ## Models Updated

   **Version:** {old} → {new}
   **Models:** {count} known models
   **Aliases:** {count} short aliases
   **Roles:** {count} role assignments
   **Teams:** {count} team compositions

   ### Changes
   - {alias}: {old_model} → {new_model}
   - ...

   ### Warnings
   - {any warnings from API}

   Updated: shared/model-aliases.json
   ```

### API Reference

- **Endpoint:** `https://us-central1-claudish-6da10.cloudfunctions.net/queryPluginDefaults`
- **Method:** GET
- **Auth:** None required
- **Cache:** 5 minutes server-side
- **Param:** `?resolve=true` — expands aliases to full model IDs in roles/teams
- **Response fields:**
  - `version` — semver, bumped on config changes
  - `generatedAt` — ISO timestamp
  - `shortAliases` — `{alias: fullModelId}` map
  - `roles` — `{roleName: {modelId, fallback?}}` map
  - `teams` — `{teamName: [modelIds]}` map
  - `knownModels` — `{modelId: {displayName, provider, contextWindow, capabilities, status}}` map
  - `warnings` — optional array of issues (missing models, etc.)

### Error Handling

- If fetch fails: "Cannot reach model database. Check internet connection."
- If response is invalid: "Invalid response from API. Try again later."
- If no changes: "Model aliases are already up to date (version {version})."
