import React from "react";
import type { Screen } from "../state/types.js";

interface Tab {
	key: string;
	label: string;
	screen: Screen;
}

const TABS: Tab[] = [
	{ key: "1", label: "Plugins", screen: "plugins" },
	{ key: "2", label: "Skills", screen: "skills" },
	{ key: "3", label: "MCP", screen: "mcp" },
	{ key: "4", label: "Settings", screen: "settings" },
	{ key: "5", label: "Profiles", screen: "profiles" },
	{ key: "6", label: "CLI", screen: "cli-tools" },
];

interface TabBarProps {
	currentScreen: Screen;
}

export function TabBar({ currentScreen }: TabBarProps) {
	return (
		<box flexDirection="row" gap={0}>
			{TABS.map((tab, index) => {
				const isSelected = tab.screen === currentScreen;
				const isLast = index === TABS.length - 1;

				return (
					<box key={tab.key} flexDirection="row">
						{/* Tab content */}
						{isSelected ? (
							<box>
								<text bg="#7e57c2" fg="white">
									<strong>
										{" "}
										{tab.key}:{tab.label}{" "}
									</strong>
								</text>
							</box>
						) : (
							<box>
								<text fg="gray">
									{" "}
									{tab.key}:{tab.label}{" "}
								</text>
							</box>
						)}
						{/* Separator */}
						{!isLast && <text fg="#666666">│</text>}
					</box>
				);
			})}
		</box>
	);
}

export default TabBar;
