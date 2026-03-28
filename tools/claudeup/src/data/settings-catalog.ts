export type SettingCategory =
	| "recommended"
	| "agents"
	| "models"
	| "workflow"
	| "terminal"
	| "performance"
	| "advanced";
export type SettingType = "boolean" | "string" | "select";
export type SettingStorage =
	| { type: "env"; key: string }
	| { type: "setting"; key: string }
	| { type: "attribution" };

export interface SettingDefinition {
	id: string;
	name: string;
	description: string;
	category: SettingCategory;
	type: SettingType;
	options?: { label: string; value: string }[];
	defaultValue?: string;
	storage: SettingStorage;
}

export const SETTINGS_CATALOG: SettingDefinition[] = [
	// ═══════ RECOMMENDED ═══════
	{
		id: "enable-tasks",
		name: "Task Tracking",
		description:
			"Enable task list for tracking progress. Shows visual task tracking in interactive and non-interactive mode",
		category: "recommended",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_ENABLE_TASKS" },
		defaultValue: "false",
	},
	{
		id: "task-list-id",
		name: "Task List ID",
		description:
			"Share task list across sessions. Set same ID in multiple instances to coordinate on shared tasks",
		category: "recommended",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_TASK_LIST_ID" },
	},
	{
		id: "enable-agent-teams",
		name: "Agent Teams",
		description:
			"Enable agent teams. Allow Claude to spawn teammate agents that work in parallel via tmux or in-process",
		category: "recommended",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" },
		defaultValue: "false",
	},
	{
		id: "effort-level",
		name: "Effort Level",
		description:
			"How much effort Claude puts into responses. Persists across sessions",
		category: "recommended",
		type: "select",
		options: [
			{ label: "Low", value: "low" },
			{ label: "Medium", value: "medium" },
			{ label: "High", value: "high" },
		],
		storage: { type: "setting", key: "effortLevel" },
	},
	{
		id: "enable-all-project-mcp-servers",
		name: "Auto-approve Project MCP Servers",
		description:
			"Auto-approve all MCP servers in project .mcp.json files without prompting",
		category: "recommended",
		type: "boolean",
		storage: { type: "setting", key: "enableAllProjectMcpServers" },
	},

	// ═══════ AGENTS & TEAMS ═══════
	{
		id: "team-name",
		name: "Team Name",
		description:
			"Name of the agent team this instance belongs to. Set automatically on team members",
		category: "agents",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_TEAM_NAME" },
	},
	{
		id: "plan-mode-required",
		name: "Plan Mode Required",
		description:
			"Require plan approval before teammates can execute. Auto-set on agent team teammates",
		category: "agents",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_PLAN_MODE_REQUIRED" },
	},
	{
		id: "teammate-mode",
		name: "Teammate Display Mode",
		description:
			"How agent team teammates display: auto picks split panes in tmux/iTerm2, in-process otherwise",
		category: "agents",
		type: "select",
		options: [
			{ label: "Auto", value: "auto" },
			{ label: "In-process", value: "in-process" },
			{ label: "tmux", value: "tmux" },
		],
		storage: { type: "setting", key: "teammateMode" },
	},
	{
		id: "subagent-model",
		name: "Subagent Model",
		description:
			"Override model used for subagents spawned by the main session",
		category: "agents",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_SUBAGENT_MODEL" },
	},
	{
		id: "agent",
		name: "Run as Named Agent",
		description:
			"Run the main thread as a named subagent. Applies that subagent's system prompt, tool restrictions, and model",
		category: "agents",
		type: "string",
		storage: { type: "setting", key: "agent" },
	},

	// ═══════ MODELS & THINKING ═══════
	{
		id: "model",
		name: "Default Model",
		description: "Override the default model for Claude Code",
		category: "models",
		type: "select",
		options: [
			{ label: "Default", value: "" },
			{ label: "Sonnet", value: "claude-sonnet-4-6" },
			{ label: "Opus", value: "claude-opus-4-6" },
			{ label: "Haiku", value: "claude-haiku-4-5-20251001" },
		],
		storage: { type: "setting", key: "model" },
	},
	{
		id: "always-thinking",
		name: "Always Extended Thinking",
		description: "Enable extended thinking by default for all sessions",
		category: "models",
		type: "boolean",
		storage: { type: "setting", key: "alwaysThinkingEnabled" },
		defaultValue: "false",
	},
	{
		id: "max-thinking-tokens",
		name: "Max Thinking Tokens",
		description:
			"Override extended thinking token budget. Set to 0 to disable thinking entirely",
		category: "models",
		type: "string",
		storage: { type: "env", key: "MAX_THINKING_TOKENS" },
	},
	{
		id: "disable-adaptive-thinking",
		name: "Disable Adaptive Thinking",
		description:
			"Disable adaptive reasoning for Opus and Sonnet. Falls back to fixed thinking budget",
		category: "models",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING" },
		defaultValue: "false",
	},
	{
		id: "disable-1m-context",
		name: "Disable 1M Context",
		description:
			"Disable 1M context window support. 1M model variants become unavailable",
		category: "models",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_1M_CONTEXT" },
		defaultValue: "false",
	},

	// ═══════ WORKFLOW ═══════
	{
		id: "include-git-instructions",
		name: "Git Workflow Instructions",
		description:
			"Include built-in commit and PR workflow instructions in system prompt",
		category: "workflow",
		type: "boolean",
		storage: { type: "setting", key: "includeGitInstructions" },
		defaultValue: "true",
	},
	{
		id: "disable-git-instructions",
		name: "Disable Git Instructions",
		description:
			"Remove built-in git workflow instructions from system prompt. Takes precedence over includeGitInstructions setting",
		category: "workflow",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS" },
		defaultValue: "false",
	},
	{
		id: "attribution",
		name: "AI Attribution in Commits & PRs",
		description:
			"Add 'Co-Authored-By: Claude' and '🤖 Generated with Claude Code' to git commits and PR descriptions",
		category: "workflow",
		type: "boolean",
		storage: { type: "attribution" },
		defaultValue: "true",
	},
	{
		id: "output-style",
		name: "Output Style",
		description: "Adjust Claude's response style",
		category: "workflow",
		type: "select",
		options: [
			{ label: "Default", value: "" },
			{ label: "Concise", value: "concise" },
			{ label: "Explanatory", value: "explanatory" },
			{ label: "Formal", value: "formal" },
			{ label: "Minimal", value: "minimal" },
		],
		storage: { type: "setting", key: "outputStyle" },
	},
	{
		id: "language",
		name: "Response Language",
		description: "Language Claude responds in",
		category: "workflow",
		type: "select",
		options: [
			{ label: "Default (English)", value: "" },
			{ label: "Spanish", value: "spanish" },
			{ label: "French", value: "french" },
			{ label: "German", value: "german" },
			{ label: "Japanese", value: "japanese" },
			{ label: "Chinese", value: "chinese" },
			{ label: "Korean", value: "korean" },
			{ label: "Portuguese", value: "portuguese" },
			{ label: "Italian", value: "italian" },
			{ label: "Russian", value: "russian" },
			{ label: "Ukrainian", value: "ukrainian" },
			{ label: "Arabic", value: "arabic" },
			{ label: "Hindi", value: "hindi" },
		],
		storage: { type: "setting", key: "language" },
	},
	{
		id: "plans-directory",
		name: "Plans Directory",
		description:
			"Where plan files are stored. Path relative to project root. Default: ~/.claude/plans",
		category: "workflow",
		type: "string",
		storage: { type: "setting", key: "plansDirectory" },
	},
	{
		id: "default-permission-mode",
		name: "Default Permission Mode",
		description: "Default permission mode when opening Claude Code",
		category: "workflow",
		type: "select",
		options: [
			{ label: "Default", value: "default" },
			{ label: "Accept Edits", value: "acceptEdits" },
			{ label: "Bypass Permissions", value: "bypassPermissions" },
		],
		storage: { type: "setting", key: "permissions.defaultMode" },
	},
	{
		id: "disable-bypass-permissions",
		name: "Disable Bypass Permissions Mode",
		description:
			"Prevent bypassPermissions mode from being activated. Disables --dangerously-skip-permissions flag",
		category: "workflow",
		type: "select",
		options: [
			{ label: "Not set", value: "" },
			{ label: "Disable", value: "disable" },
		],
		storage: { type: "setting", key: "disableBypassPermissionsMode" },
	},
	{
		id: "additional-directories",
		name: "Additional Directories",
		description:
			"Additional working directories Claude has access to, comma-separated",
		category: "workflow",
		type: "string",
		storage: { type: "setting", key: "permissions.additionalDirectories" },
	},
	{
		id: "respect-gitignore",
		name: "Respect .gitignore",
		description:
			"Exclude .gitignore-matched files from @ file picker suggestions",
		category: "workflow",
		type: "boolean",
		storage: { type: "setting", key: "respectGitignore" },
		defaultValue: "true",
	},
	{
		id: "enable-tool-search",
		name: "MCP Tool Search",
		description:
			"Control MCP tool search behavior. Auto enables at percentage of context used",
		category: "workflow",
		type: "select",
		options: [
			{ label: "Default", value: "" },
			{ label: "Always on", value: "true" },
			{ label: "Auto (10%)", value: "auto" },
			{ label: "Disabled", value: "false" },
		],
		storage: { type: "env", key: "ENABLE_TOOL_SEARCH" },
	},

	// ═══════ TERMINAL & UI ═══════
	{
		id: "shell",
		name: "Shell Override",
		description:
			"Override automatic shell detection. Useful when login shell differs from preferred working shell",
		category: "terminal",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_SHELL" },
	},
	{
		id: "shell-prefix",
		name: "Shell Command Prefix",
		description:
			"Command prefix to wrap all bash commands, e.g. for logging or auditing",
		category: "terminal",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_SHELL_PREFIX" },
	},
	{
		id: "prompt-suggestion",
		name: "Prompt Suggestions",
		description:
			"Show prompt suggestions after Claude responds. Grayed-out predictions in prompt input",
		category: "terminal",
		type: "select",
		options: [
			{ label: "Default", value: "" },
			{ label: "Enabled", value: "true" },
			{ label: "Disabled", value: "false" },
		],
		storage: { type: "env", key: "CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION" },
	},
	{
		id: "voice-enabled",
		name: "Voice Dictation",
		description:
			"Enable push-to-talk voice dictation. Requires Claude.ai account",
		category: "terminal",
		type: "boolean",
		storage: { type: "setting", key: "voiceEnabled" },
		defaultValue: "false",
	},
	{
		id: "spinner-tips",
		name: "Spinner Tips",
		description: "Show tips in the spinner while Claude is working",
		category: "terminal",
		type: "boolean",
		storage: { type: "setting", key: "spinnerTipsEnabled" },
		defaultValue: "true",
	},
	{
		id: "disable-terminal-title",
		name: "Disable Terminal Title",
		description:
			"Disable automatic terminal title updates based on conversation context",
		category: "terminal",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_TERMINAL_TITLE" },
		defaultValue: "false",
	},
	{
		id: "terminal-progress-bar",
		name: "Terminal Progress Bar",
		description:
			"Show terminal progress bar in supported terminals like Windows Terminal and iTerm2",
		category: "terminal",
		type: "boolean",
		storage: { type: "setting", key: "terminalProgressBarEnabled" },
		defaultValue: "true",
	},
	{
		id: "reduced-motion",
		name: "Reduced Motion",
		description:
			"Reduce or disable UI animations (spinners, shimmer, flash effects) for accessibility",
		category: "terminal",
		type: "boolean",
		storage: { type: "setting", key: "prefersReducedMotion" },
		defaultValue: "false",
	},

	// ═══════ PERFORMANCE ═══════
	{
		id: "max-output-tokens",
		name: "Max Output Tokens",
		description:
			"Maximum output tokens per response. Increasing reduces context window before auto-compaction",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_MAX_OUTPUT_TOKENS" },
	},
	{
		id: "file-read-max-output-tokens",
		name: "File Read Token Limit",
		description:
			"Override default token limit for file reads. Useful for reading larger files in full",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS" },
	},
	{
		id: "max-mcp-output-tokens",
		name: "Max MCP Output Tokens",
		description:
			"Maximum tokens in MCP tool responses. Warning at 10,000 tokens. Default: 25000",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "MAX_MCP_OUTPUT_TOKENS" },
	},
	{
		id: "bash-timeout",
		name: "Bash Default Timeout",
		description: "Default timeout for bash commands in milliseconds",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "BASH_DEFAULT_TIMEOUT_MS" },
		defaultValue: "120000",
	},
	{
		id: "bash-max-timeout",
		name: "Bash Max Timeout",
		description:
			"Maximum timeout the model can set for bash commands in milliseconds",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "BASH_MAX_TIMEOUT_MS" },
	},
	{
		id: "autocompact-pct",
		name: "Auto-compaction Threshold",
		description:
			"Context capacity percentage (1-100) at which auto-compaction triggers. Default ~95%",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" },
	},
	{
		id: "auto-compact-window",
		name: "Auto-compaction Window",
		description:
			"Context capacity in tokens for compaction calculations. Use lower value to compact earlier on 1M models",
		category: "performance",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CODE_AUTO_COMPACT_WINDOW" },
	},
	{
		id: "cleanup-period-days",
		name: "Session Cleanup Period",
		description:
			"Sessions inactive longer than this are deleted at startup. Default: 30. Set to 0 to disable persistence",
		category: "performance",
		type: "string",
		storage: { type: "setting", key: "cleanupPeriodDays" },
	},

	// ═══════ ADVANCED ═══════
	{
		id: "disable-telemetry",
		name: "Disable Statsig Telemetry",
		description:
			"Opt out of Statsig telemetry. Events do not include user data like code or file paths",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "DISABLE_TELEMETRY" },
		defaultValue: "false",
	},
	{
		id: "enable-otel",
		name: "Enable OpenTelemetry",
		description: "Enable OpenTelemetry data collection for metrics and logging",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_ENABLE_TELEMETRY" },
		defaultValue: "false",
	},
	{
		id: "disable-autoupdater",
		name: "Disable Auto Updater",
		description: "Disable automatic updates for Claude Code",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "DISABLE_AUTOUPDATER" },
		defaultValue: "false",
	},
	{
		id: "force-autoupdate-plugins",
		name: "Force Plugin Auto-updates",
		description:
			"Force plugin auto-updates even when main auto-updater is disabled",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "FORCE_AUTOUPDATE_PLUGINS" },
		defaultValue: "false",
	},
	{
		id: "disable-cost-warnings",
		name: "Disable Cost Warnings",
		description: "Disable cost warning messages",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "DISABLE_COST_WARNINGS" },
		defaultValue: "false",
	},
	{
		id: "disable-error-reporting",
		name: "Disable Error Reporting",
		description: "Opt out of Sentry error reporting",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "DISABLE_ERROR_REPORTING" },
		defaultValue: "false",
	},
	{
		id: "disable-feedback-command",
		name: "Disable /feedback Command",
		description: "Disable the /feedback command",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "DISABLE_FEEDBACK_COMMAND" },
		defaultValue: "false",
	},
	{
		id: "disable-feedback-survey",
		name: "Disable Feedback Surveys",
		description: "Disable session quality surveys",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY" },
		defaultValue: "false",
	},
	{
		id: "disable-nonessential-traffic",
		name: "Disable Non-essential Traffic",
		description:
			"Disable auto-updater, feedback, error reporting, and telemetry at once",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" },
		defaultValue: "false",
	},
	{
		id: "disable-cron",
		name: "Disable Cron Tasks",
		description:
			"Disable scheduled tasks. /loop skill and cron tools become unavailable",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_CRON" },
		defaultValue: "false",
	},
	{
		id: "disable-background-tasks",
		name: "Disable Background Tasks",
		description:
			"Disable background tasks, run_in_background parameter, and Ctrl+B shortcut",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS" },
		defaultValue: "false",
	},
	{
		id: "disable-fast-mode",
		name: "Disable Fast Mode",
		description: "Disable fast mode toggle",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_FAST_MODE" },
		defaultValue: "false",
	},
	{
		id: "disable-auto-memory",
		name: "Disable Auto Memory",
		description: "Stop Claude from creating and loading auto memory files",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_DISABLE_AUTO_MEMORY" },
		defaultValue: "false",
	},
	{
		id: "simple-mode",
		name: "Simple Mode",
		description:
			"Run with minimal system prompt and only Bash, file read, and edit tools. Disables MCP, hooks, CLAUDE.md",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_SIMPLE" },
		defaultValue: "false",
	},
	{
		id: "ide-skip-auto-install",
		name: "Skip IDE Extension Install",
		description: "Skip auto-installation of IDE extensions",
		category: "advanced",
		type: "boolean",
		storage: { type: "env", key: "CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL" },
		defaultValue: "false",
	},
	{
		id: "use-builtin-ripgrep",
		name: "Bundled ripgrep",
		description:
			"Set to 0 to use system-installed rg instead of bundled version",
		category: "advanced",
		type: "select",
		options: [
			{ label: "Default", value: "" },
			{ label: "System rg", value: "0" },
		],
		storage: { type: "env", key: "USE_BUILTIN_RIPGREP" },
	},
	{
		id: "config-dir",
		name: "Config Directory",
		description:
			"Custom directory for Claude Code configuration and data files",
		category: "advanced",
		type: "string",
		storage: { type: "env", key: "CLAUDE_CONFIG_DIR" },
	},
	{
		id: "env-file",
		name: "Env File Path",
		description:
			"Path to shell script sourced before each Bash command. Use for virtualenv/conda activation",
		category: "advanced",
		type: "string",
		storage: { type: "env", key: "CLAUDE_ENV_FILE" },
	},
	{
		id: "additional-dirs-claude-md",
		name: "Load CLAUDE.md from Extra Dirs",
		description:
			"Load CLAUDE.md files from directories specified with --add-dir",
		category: "advanced",
		type: "boolean",
		storage: {
			type: "env",
			key: "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD",
		},
		defaultValue: "false",
	},
	{
		id: "auto-updates-channel",
		name: "Update Channel",
		description:
			"Release channel: stable (typically one week old, skips regressions) or latest",
		category: "advanced",
		type: "select",
		options: [
			{ label: "Latest", value: "latest" },
			{ label: "Stable", value: "stable" },
		],
		storage: { type: "setting", key: "autoUpdatesChannel" },
	},
	{
		id: "worktree-symlink-directories",
		name: "Worktree Symlink Directories",
		description:
			"Directories to symlink from main repo into each worktree, comma-separated. Reduces disk usage",
		category: "advanced",
		type: "string",
		storage: { type: "setting", key: "worktree.symlinkDirectories" },
	},
	{
		id: "worktree-sparse-paths",
		name: "Worktree Sparse Paths",
		description:
			"Directories for git sparse-checkout in worktrees, comma-separated. Only listed paths are written to disk",
		category: "advanced",
		type: "string",
		storage: { type: "setting", key: "worktree.sparsePaths" },
	},
];
