import React from "react";
import type { SelectOption } from "../../state/types.js";

interface SelectModalProps {
	/** Modal title */
	title: string;
	/** Modal message */
	message: string;
	/** Select options */
	options: SelectOption[];
	/** Currently selected index (controlled by ModalContainer) */
	defaultIndex?: number;
	/** Callback when option selected */
	onSelect: (value: string) => void;
	/** Callback when cancelled */
	onCancel: () => void;
}

export function SelectModal({
	title,
	message,
	options,
	defaultIndex,
	onSelect: _onSelect,
	onCancel: _onCancel,
}: SelectModalProps) {
	// Keyboard handling is done by ModalContainer
	// defaultIndex is the live selectedIndex from ModalContainer state
	const selectedIndex = defaultIndex ?? 0;

	return (
		<box
			flexDirection="column"
			border
			borderStyle="rounded"
			borderColor="cyan"
			backgroundColor="#1a1a2e"
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			width={50}
		>
			<text>
				<strong>{title}</strong>
			</text>

			<box marginTop={1} marginBottom={1}>
				<text>{message}</text>
			</box>

			<box flexDirection="column">
				{options.map((option, idx) => {
					const isSelected = idx === selectedIndex;
					const label = isSelected ? `> ${option.label}` : `  ${option.label}`;
					return (
						<text key={option.value} fg={isSelected ? "cyan" : "#666666"}>
							{isSelected && <strong>{label}</strong>}
							{!isSelected && label}
						</text>
					);
				})}
			</box>

			<box marginTop={1}>
				<text fg="#666666">↑↓ Select • Enter • Esc</text>
			</box>
		</box>
	);
}

export default SelectModal;
