import React, { useState, useEffect } from "react";

interface LoadingModalProps {
	/** Loading message */
	message: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function LoadingModal({ message }: LoadingModalProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
		}, 80);

		return () => clearInterval(interval);
	}, []);

	return (
		<box
			flexDirection="row"
			border
			borderStyle="rounded"
			borderColor="#525252"
			backgroundColor="#1C1C1E"
			paddingLeft={3}
			paddingRight={3}
			paddingTop={1}
			paddingBottom={1}
		>
			<text fg="#A1A1AA">{SPINNER_FRAMES[frame]}</text>
			<text fg="#EDEDED"> {message}</text>
		</box>
	);
}

export default LoadingModal;
