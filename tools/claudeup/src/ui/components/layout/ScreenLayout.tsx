import React from "react";
import { useDimensions } from "../../state/DimensionsContext.js";
import { TabBar } from "../TabBar.js";
import type { Screen } from "../../state/types.js";

interface ScreenLayoutProps {
	/** Screen title (e.g., "claudeup Plugins") */
	title: string;
	/** Optional subtitle shown to the right of title */
	subtitle?: string;
	/** Current screen for tab highlighting */
	currentScreen: Screen;
	/** Search bar configuration (for screens with search) */
	search?: {
		/** Is search currently active */
		isActive: boolean;
		/** Current search query */
		query: string;
		/** Placeholder when not searching (default: "/") */
		placeholder?: string;
	};
	/** Status line content (for screens without search) - shown in second row */
	statusLine?: React.ReactNode;
	/** Footer hints (left side) */
	footerHints: string;
	/** Left panel content */
	listPanel: React.ReactNode;
	/** Right panel content (detail view) */
	detailPanel: React.ReactNode;
}

const HEADER_COLOR = "#7e57c2";

export function ScreenLayout({
	title,
	subtitle,
	currentScreen,
	search,
	statusLine,
	footerHints,
	listPanel,
	detailPanel,
}: ScreenLayoutProps) {
	const dimensions = useDimensions();

	const hasSearchBar = search && (search.isActive || search.query);

	// Fixed chrome: top line + tabs + line + header + separator + footer = 6
	// Search bar adds 1 when active
	const fixedHeight = 6 + (hasSearchBar ? 1 : 0);
	const panelHeight = Math.max(5, dimensions.contentHeight - fixedHeight);
	const lineWidth = Math.max(10, dimensions.terminalWidth - 4);

	return (
		<box flexDirection="column" height={dimensions.contentHeight}>
			{/* Line above tabs */}
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg="#333333">{"─".repeat(lineWidth)}</text>
			</box>

			{/* Tab bar */}
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TabBar currentScreen={currentScreen} />
			</box>

			{/* Line below tabs */}
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg="#333333">{"─".repeat(lineWidth)}</text>
			</box>

			{/* Header — title on left, subtitle/status on right */}
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
				<text fg={HEADER_COLOR}>
					<strong>{title}</strong>
				</text>
				{subtitle && <text fg="gray">{subtitle}</text>}
				{!subtitle && statusLine ? statusLine : null}
			</box>

			{/* Search bar — own line, only when active */}
			{hasSearchBar && (
				<box height={1} paddingLeft={1} paddingRight={1}>
					{search.isActive ? (
						<text>
							<span fg="green">{"Filter: "}</span>
							<span fg="white">{search.query}</span>
							<span bg="white" fg="black"> </span>
						</text>
					) : (
						<text>
							<span fg="green">{"Filter: "}</span>
							<span fg="yellow">{search.query}</span>
							<span fg="gray">  (Esc to clear)</span>
						</text>
					)}
				</box>
			)}

			{/* Separator below header */}
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg="#444444">{"─".repeat(lineWidth)}</text>
			</box>

			{/* Main content area */}
			<box flexDirection="row" height={panelHeight}>
				{/* List panel */}
				<box
					flexDirection="column"
					width="49%"
					height={panelHeight}
					paddingRight={1}
				>
					{listPanel}
				</box>

				{/* Vertical separator */}
				<box flexDirection="column" width={1} height={panelHeight}>
					<text fg="#444444">{"│".repeat(panelHeight)}</text>
				</box>

				{/* Detail panel */}
				<box
					flexDirection="column"
					width="50%"
					paddingLeft={1}
				>
					{detailPanel}
				</box>
			</box>

			{/* Footer */}
			<box height={1} paddingLeft={1}>
				<text fg="gray">{footerHints}</text>
			</box>
		</box>
	);
}

export default ScreenLayout;
