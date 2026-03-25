import React from "react";

/**
 * Renders 3 colored squares showing install status per scope:
 *   ■■□  = user + project installed, local not
 *   □■□  = only project
 *   □□□  = not installed anywhere
 *
 * Colors: cyan=user, green=project, yellow=local
 * Filled square: ■  Empty square: □
 */

interface ScopeIndicatorProps {
	user?: boolean;
	project?: boolean;
	local?: boolean;
}

export function scopeIndicatorText(
	user?: boolean,
	project?: boolean,
	local?: boolean,
): { chars: string; colors: [string, string, string] } {
	return {
		chars: `${user ? "■" : "□"}${project ? "■" : "□"}${local ? "■" : "□"}`,
		colors: [
			user ? "cyan" : "#444444",
			project ? "green" : "#444444",
			local ? "yellow" : "#444444",
		],
	};
}

export function ScopeIndicator({ user, project, local }: ScopeIndicatorProps) {
	return (
		<text>
			<span fg={user ? "cyan" : "#444444"}>{user ? "■" : "□"}</span>
			<span fg={project ? "green" : "#444444"}>{project ? "■" : "□"}</span>
			<span fg={local ? "yellow" : "#444444"}>{local ? "■" : "□"}</span>
		</text>
	);
}

/**
 * For skills (only 2 scopes: user + project)
 */
export function ScopeIndicator2({
	user,
	project,
}: { user?: boolean; project?: boolean }) {
	return (
		<text>
			<span fg={user ? "cyan" : "#444444"}>{user ? "■" : "□"}</span>
			<span fg={project ? "green" : "#444444"}>{project ? "■" : "□"}</span>
		</text>
	);
}
