import React from "react";

interface InputModalProps {
	/** Modal title */
	title: string;
	/** Input label */
	label: string;
	/** Default input value */
	defaultValue?: string;
	/** Callback when submitted */
	onSubmit: (value: string) => void;
	/** Callback when cancelled */
	onCancel: () => void;
}

export function InputModal({
	title,
	label,
	defaultValue = "",
	onSubmit,
}: InputModalProps) {
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
				<text fg="#A1A1AA">{label}</text>
			</box>

			<box border borderStyle="rounded" borderColor="#3F3F46" paddingLeft={1} paddingRight={1} width={54}>
				<input
					value={defaultValue}
					onSubmit={onSubmit as any}
					focused
					width={50}
				/>
			</box>

			<box marginTop={1}>
				<text fg="#71717A">↵ to confirm • Esc to cancel</text>
			</box>
		</box>
	);
}

export default InputModal;
