import React from "react";
import { useKeyboard } from "../../hooks/useKeyboard.js";

interface ConfirmModalProps {
	/** Modal title */
	title: string;
	/** Modal message */
	message: string;
	/** Callback when confirmed */
	onConfirm: () => void;
	/** Callback when cancelled */
	onCancel: () => void;
}

export function ConfirmModal({
	title,
	message,
	onConfirm,
	onCancel,
}: ConfirmModalProps) {
	useKeyboard((key) => {
		if (key.name === "y" || key.name === "Y") {
			onConfirm();
		} else if (key.name === "n" || key.name === "N" || key.name === "escape") {
			onCancel();
		}
	});

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
			width={60}
		>
			<box marginBottom={1}>
				<text fg="#EDEDED">
					<strong>{title}</strong>
				</text>
			</box>
			<box marginBottom={1}>
				<text fg="#A1A1AA">{message}</text>
			</box>
			<box marginTop={1}>
				<text fg="#71717A">Press </text>
				<text fg="#EDEDED">Y</text>
				<text fg="#71717A"> to confirm • </text>
				<text fg="#EDEDED">N</text>
				<text fg="#71717A"> to cancel</text>
			</box>
		</box>
	);
}

export default ConfirmModal;
