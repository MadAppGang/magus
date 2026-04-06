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
			borderColor="#525252"
			backgroundColor="#1C1C1E"
			paddingLeft={3}
			paddingRight={3}
			paddingTop={1}
			paddingBottom={1}
			width={50}
		>
			<box marginBottom={1}>
				<text fg="#EDEDED">
					<strong>{title}</strong>
				</text>
			</box>

			<box marginBottom={1}>
				<text fg="#A1A1AA">{message}</text>
			</box>

			<box flexDirection="column" paddingLeft={1}>
				{options.map((option, idx) => {
					const isSelected = idx === selectedIndex;
					return (
						<text key={option.value} fg={isSelected ? "#F4F4F5" : "#A1A1AA"}>
							<span fg={isSelected ? "#F4F4F5" : "#71717A"}>
								{isSelected ? "❯ " : "  "}
							</span>
							{isSelected ? <strong>{option.label}</strong> : option.label}
						</text>
					);
				})}
			</box>

			<box marginTop={1}>
				<text fg="#71717A">↑↓ Select • ↵ Confirm • Esc Cancel</text>
			</box>
		</box>
	);
}

export default SelectModal;
