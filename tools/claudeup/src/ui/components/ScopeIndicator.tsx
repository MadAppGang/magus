import React from "react";

/**
 * Scope indicator for list items.
 * Shows colored letter badges when installed, empty space when not.
 *
 * Installed in user+project:  u p
 * Installed in project only:    p
 * Not installed:              (3 spaces)
 *
 * Colors match the detail panel: cyan=user, green=project, yellow=local
 */

export function scopeIndicatorText(
	user?: boolean,
	project?: boolean,
	local?: boolean,
): { text: string; segments: Array<{ char: string; bg: string; fg: string }> } {
	const segments: Array<{ char: string; bg: string; fg: string }> = [
		user
			? { char: "u", bg: "cyan", fg: "black" }
			: { char: " ", bg: "", fg: "" },
		project
			? { char: "p", bg: "green", fg: "black" }
			: { char: " ", bg: "", fg: "" },
		local
			? { char: "l", bg: "yellow", fg: "black" }
			: { char: " ", bg: "", fg: "" },
	];

	const text = segments.map((s) => s.char).join("");
	return { text, segments };
}

interface ScopeIndicatorProps {
	user?: boolean;
	project?: boolean;
	local?: boolean;
}

export function ScopeIndicator({ user, project, local }: ScopeIndicatorProps) {
	const { segments } = scopeIndicatorText(user, project, local);

	return (
		<text>
			{segments.map((s, i) =>
				s.bg ? (
					<span key={i} bg={s.bg} fg={s.fg}>
						{s.char}
					</span>
				) : (
					<span key={i}> </span>
				),
			)}
		</text>
	);
}
