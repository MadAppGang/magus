# Statusline — deprecated

**This plugin is a redirect. The statusline now ships inside `setup@magus`.**

It exists so that existing installs do not break silently: the `/statusline:*` commands keep
resolving for one more release, then this plugin is removed.

## What to use instead

| Old | New |
|---|---|
| `/statusline:install` | `/setup:statusline-install` |
| `/statusline:customize` | `/setup:statusline-customize` |
| `/statusline:uninstall` | `/setup:statusline-uninstall` |

## Migrating

Enable `setup@magus` and disable this plugin:

```json
{
  "enabledPlugins": {
    "setup@magus": true,
    "statusline@magus": false
  }
}
```

Your existing statusline configuration is unaffected. The commands moved; the statusline
itself and its settings did not change.

If you are installing fresh, skip this plugin entirely and use `setup@magus`.

## What the statusline does

Always-visible usage bars, provider-aware model display, git and session chips, RAM usage,
worktree awareness, and countdowns to your next limit reset. On sessions routed through
claudish it swaps Anthropic's plan limits for the routed provider's.

Full documentation lives with the plugin that now owns it: see
[`plugins/setup/README.md`](../setup/README.md).
