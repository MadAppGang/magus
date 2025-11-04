# Figma Integration Guide

Complete guide for integrating Figma Make projects with the frontend-development plugin.

## What is Figma Make?

**Figma Make** is Figma's prototyping and code generation feature that creates actual working code from your designs. Unlike regular Figma design files, Make projects contain:

- Real React/TypeScript component code
- Working prototypes with interactions
- Production-ready implementations
- Styles and behavior definitions

The Make + MCP integration allows Claude to fetch resources directly from your Make projects and integrate them into your codebase.

## Getting Figma Make URLs

The `/import-figma` command uses Figma Make project URLs to fetch working code. Here's how to get them:

### Method 1: From Figma Make Project (Recommended)

1. **Create or open a Make project** in Figma
   - Go to figma.com/make or use "Make" feature in Figma
   - Create a prototype with components

2. **Copy the Make project URL** from your browser
   - The URL will be in this format:
   ```
   https://www.figma.com/make/{projectId}/{projectName}?node-id={nodeId}
   ```

3. **Example Make URL:**
   ```
   https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/Implement-Screen-in-Shadcn?node-id=0-1&t=GZmiQgdDkZ6PjFRG-1
   ```

**Key parts of the URL:**
- `/make/` - Indicates this is a Make project (not a design file)
- `{projectId}` - The unique Make project identifier
- `{projectName}` - Your project name (URL-encoded)
- `node-id` - The specific component/screen to fetch (optional)

### Method 2: Share from Make

1. **Open your Make project** in Figma
2. **Click "Share" button** in the top-right
3. **Copy the share link**
4. **Ensure the link includes `node-id`** if targeting a specific component
5. **Use this URL** in your CLAUDE.md

### Method 3: From Component in Make

To target a specific component within your Make project:

1. **Select the component** in your Make project
2. **Right-click and select "Copy link"**
3. **The URL will include the node-id** parameter
4. **Use the full URL** including node-id

**Example with specific component:**
```
https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/MyProject?node-id=45-678
```

### Understanding Make vs Design Files

**Important:** Figma Make URLs use `/make/` in the path, not `/file/` or `/design/`:

```
❌ Regular Design File:
https://www.figma.com/file/abc123/MyDesign

✅ Make Project (with code):
https://www.figma.com/make/abc123/MyProject
```

Only Make projects contain actual working code that can be imported.

## Adding URLs to CLAUDE.md

Once you have the Figma Make URL, add it to your project's `CLAUDE.md` file:

```markdown
## Design Resources

**Figma Make Project**: https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/Implement-Screen-in-Shadcn?node-id=0-1

### Component Mapping

Track components imported from Figma Make:

| Component Name | Node ID | Status | File Path |
|----------------|---------|--------|-----------|
| UserCard | 0-1 | ✅ Imported | src/components/ui/user-card.tsx |
| ProfileHeader | 0-2 | 🔄 Pending | - |
| DashboardLayout | 0-3 | ✅ Imported | src/components/layouts/dashboard.tsx |
```

**Real example:**
```markdown
## Design Resources

**Figma Make Project**: https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/Implement-Screen-in-Shadcn?node-id=0-1&t=GZmiQgdDkZ6PjFRG-1
```

## How Figma Make + MCP Integration Works

The integration uses **MCP Resources** to fetch context directly from your Make projects:

### MCP Resources Workflow

1. **You provide the Make link** to Claude (via CLAUDE.md or directly)
2. **Claude fetches available files** from your Make project using MCP
3. **You select which files to download** (or Claude auto-selects)
4. **Claude integrates the code** into your project structure

### What Gets Fetched

From your Make project, Claude can fetch:

- **Component implementations** - React/TypeScript code
- **Styles and behavior** - CSS, animations, interactions
- **Project structure** - Multiple related files
- **Dependencies** - Required packages and imports

### MCP Resources vs Design Context

**MCP Resources (Make):**
- Fetches actual working code files
- Includes full implementations
- Gets entire project structure
- Production-ready components

**Design Context (regular Figma):**
- Generates code from design layers
- Single component at a time
- May need adaptation
- More manual integration

## Using /import-figma Command

After setting up your CLAUDE.md:

```bash
# Import components from Make project
/import-figma

# The command will:
# 1. Read the Figma Make URL from CLAUDE.md
# 2. Fetch available files using MCP resources
# 3. Select component code to import
# 4. Adapt it to your project structure
# 5. Install any missing dependencies
# 6. Create component file(s)
# 7. Set up a test route
# 8. Validate in browser
```

### Example Workflow

**Goal:** Import a popup component from Make and integrate with your existing codebase.

1. **Add Make URL to CLAUDE.md:**
   ```markdown
   **Figma Make Project**: https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/MyProject?node-id=0-1
   ```

2. **Run the import command:**
   ```bash
   /import-figma
   ```

3. **Claude will:**
   - Fetch the popup component code from Make
   - Show you available files
   - Ask which files to import
   - Adapt the code to your project patterns
   - Install dependencies (e.g., Radix UI primitives)
   - Create `src/components/ui/popup.tsx`
   - Set up test route at `/playground/popup`
   - Validate in browser

4. **You get:**
   - Working component with styles
   - Proper imports and dependencies
   - Type-safe TypeScript code
   - Tested and validated implementation

## Troubleshooting

### "Figma URL not found in CLAUDE.md"

**Solution:** Add the Figma Make URL to CLAUDE.md under "Design Resources" section:

```markdown
## Design Resources

**Figma Make Project**: https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/MyProject?node-id=0-1
```

### "Invalid Figma URL format"

**Common issues:**
- Using `/file/` or `/design/` instead of `/make/` in the URL
- Not using a Make project (regular design files won't work)
- Missing `node-id` parameter for specific components
- Node ID format wrong (should be `0-1` not `0:1`)

**Correct format for Make projects:**
```
https://www.figma.com/make/{projectId}/{projectName}?node-id={nodeId}
```

**Example:**
```
✅ Correct (Make project):
https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/Implement-Screen-in-Shadcn?node-id=0-1

❌ Incorrect (design file):
https://www.figma.com/file/abc123/MyDesign?node-id=45-678
```

### "Component not found"

**Check:**
1. Node ID is correct (try copying link to layer again)
2. Component is in the specified file
3. You have access to the Figma file
4. Figma MCP server is authenticated (`/configure-mcp`)

### "Unauthorized access"

**Solution:**
1. Make sure `FIGMA_ACCESS_TOKEN` is set in `.env`
2. Run `/configure-mcp` to verify Figma MCP server setup
3. Generate a new token from Figma settings if needed

## Alternative: Dev Mode Code Inspector

If Figma Make URLs don't work, you can:

1. **Use Figma's built-in code inspector**:
   - Open component in Dev Mode
   - Copy the generated code manually
   - Create the component file yourself
   - Then use `/import-figma` workflow

2. **Use Figma plugins**:
   - Install "Figma to Code" or similar plugin
   - Export code directly
   - Adapt it to your project

## Environment Setup

Make sure these are configured:

```bash
# .env file
FIGMA_ACCESS_TOKEN=your-figma-personal-access-token

# Get token from:
# https://www.figma.com/developers/api#access-tokens
```

## CLAUDE.md Template

Here's a complete CLAUDE.md template for Figma Make integration:

```markdown
# Project Name

## Design Resources

**Figma Make Project**: https://www.figma.com/make/DfMjRj4FzWcDHHIGRsypcM/Implement-Screen-in-Shadcn?node-id=0-1&t=GZmiQgdDkZ6PjFRG-1

### Component Mapping

Track imported components from Figma Make:

| Component Name | Node ID | File Path | Status | Notes |
|----------------|---------|-----------|--------|-------|
| UserCard | 0-1 | src/components/ui/user-card.tsx | ✅ Imported | 2024-11-04 |
| PopupDialog | 0-2 | src/components/ui/popup.tsx | ✅ Imported | With animations |
| ProfileHeader | 0-3 | src/components/profile-header.tsx | 🔄 Pending | Complex layout |
| DashboardLayout | 0-4 | src/components/layouts/dashboard.tsx | ⚠️ Needs Revision | Needs responsive fixes |

**Status Legend:**
- ✅ Imported - Component successfully imported and tested
- 🔄 Pending - Component identified in Make, not yet imported
- ⚠️ Needs Revision - Component imported but needs fixes
- 🔴 Blocked - Cannot import (missing dependencies, etc.)

### Make Project Notes

- Make project includes working prototypes with interactions
- Components use shadcn/ui and Radix UI primitives
- Styles adapted from Make to project's Tailwind config
- Animations and behaviors imported from Make implementations
- Color tokens: defined in tailwind.config.js
- Typography: uses Inter font family

### Import History

- 2024-11-04: Initial import of UserCard and PopupDialog
- 2024-11-04: Fixed responsive issues in PopupDialog
- 2024-11-05: Added ProfileHeader (pending testing)
```

## Best Practices

1. **Keep CLAUDE.md updated**: Always update the component mapping table after importing from Make
2. **Use specific node IDs**: Reference individual components in your Make project for targeted imports
3. **Test imported components**: Run the validation workflow after import to ensure interactions work
4. **Document customizations**: Note any changes made to Make component code during adaptation
5. **Version control**: Commit CLAUDE.md changes with component imports
6. **Leverage Make prototypes**: Use Make's working implementations as a starting point, then enhance for production
7. **Track dependencies**: Document which Radix UI or other libraries each Make component requires
8. **Preserve interactions**: Make components include behavior - ensure animations and interactions are preserved
9. **Adapt styles gradually**: Make components may use different styling approaches - adapt to your project's patterns
10. **Reuse Make patterns**: If multiple components use similar patterns in Make, reuse those patterns in your codebase

## Related Commands

- `/configure-mcp` - Set up Figma MCP server authentication
- `/import-figma` - Import component from Figma Make URL
- `/cleanup-artifacts` - Clean up temporary test files after import

## Need Help?

If you're still having issues:

1. Check the [DEPENDENCIES.md](../plugins/frontend-development/DEPENDENCIES.md) for MCP server setup
2. Verify Figma access token is valid
3. Ensure the component exists in your Figma file
4. Try a different component to test if issue is specific

---

**Last Updated:** November 2024
**Plugin Version:** frontend-development v1.1.0
