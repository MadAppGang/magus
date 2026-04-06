import React from "react";
import { useKeyboard } from "../../hooks/useKeyboard.js";

interface MessageModalProps {
	/** Modal title */
	title: string;
	/** Modal message */
	message: string;
	/** Message variant */
	variant: "info" | "success" | "error";
	/** Callback when dismissed */
	onDismiss: () => void;
}

const variantConfig = {
	info: { icon: "ℹ", color: "#60A5FA" },
	success: { icon: "✓", color: "#4ADE80" },
	error: { icon: "✗", color: "#F87171" },
} as const;

export function MessageModal({
	title,
	message,
	variant,
	onDismiss,
}: MessageModalProps) {
	const config = variantConfig[variant];

	useKeyboard(() => {
		// Any key dismisses
		onDismiss();
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
				<text fg={config.color}>{config.icon} </text>
				<text fg="#EDEDED">
					<strong>{title}</strong>
				</text>
			</box>

			<box marginBottom={1}>
				<text fg="#A1A1AA">{message}</text>
			</box>

			<box marginTop={1}>
				<text fg="#71717A">Press any key to continue</text>
			</box>
		</box>
	);
}

export default MessageModal;
