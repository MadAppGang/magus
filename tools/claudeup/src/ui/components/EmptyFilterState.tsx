import React from "react";

interface EmptyFilterStateProps {
	query: string;
	entityName?: string; // "plugins", "skills", "MCP servers"
}

export function EmptyFilterState({
	query,
	entityName = "items",
}: EmptyFilterStateProps) {
	return (
		<box flexDirection="column" marginTop={2} paddingLeft={2} paddingRight={2}>
			<text fg="yellow">No {entityName} found for "{query}"</text>
			<box marginTop={1}>
				<text fg="gray">Try a different search term, or if you think</text>
			</box>
			<text fg="gray">this is a bug, report it at:</text>
			<box marginTop={1}>
				<text fg="#5c9aff">github.com/MadAppGang/magus/issues</text>
			</box>
			<box marginTop={1}>
				<text fg="gray">Press Esc to clear the filter.</text>
			</box>
		</box>
	);
}
