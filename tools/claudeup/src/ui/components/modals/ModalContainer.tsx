import React, { useState } from "react";
import { useApp } from "../../state/AppContext.js";
import { useKeyboard } from "../../hooks/useKeyboard.js";
import { ConfirmModal } from "./ConfirmModal.js";
import { InputModal } from "./InputModal.js";
import { SelectModal } from "./SelectModal.js";
import { MessageModal } from "./MessageModal.js";
import { LoadingModal } from "./LoadingModal.js";

/**
 * Container that renders the active modal as an overlay
 * Handles ALL keyboard events when a modal is open to avoid
 * conflicts with multiple useKeyboard hooks in child components
 *
 * Input modal: Enter/Escape handled by OpenTUI <input> onSubmit + ModalContainer escape
 * Select modal: keyboard fully handled here (index tracking + Enter/arrows)
 */
export function ModalContainer() {
	const { state } = useApp();
	const { modal } = state;

	// Track select modal index here (lifted from SelectModal)
	const [selectIndex, setSelectIndex] = useState(0);

	// Reset select index when modal changes
	const modalRef = React.useRef(modal);
	if (modal !== modalRef.current) {
		modalRef.current = modal;
		if (modal?.type === "select") {
			setSelectIndex(modal.defaultIndex ?? 0);
		}
	}

	// Handle keyboard events for modals
	useKeyboard((key) => {
		if (!modal) return;
		if (modal.type === "loading") return;

		// Escape — close any modal
		if (key.name === "escape") {
			if (modal.type === "confirm") modal.onCancel();
			else if (modal.type === "input") modal.onCancel();
			else if (modal.type === "select") modal.onCancel();
			else if (modal.type === "message") modal.onDismiss();
			return;
		}

		// 'q' to close — but NOT for input modals (need to type 'q')
		if (key.name === "q" && modal.type !== "input") {
			if (modal.type === "confirm") modal.onCancel();
			else if (modal.type === "select") modal.onCancel();
			else if (modal.type === "message") modal.onDismiss();
			return;
		}

		// Input modal — let OpenTUI <input> handle Enter via onSubmit
		if (modal.type === "input") {
			return;
		}

		// Select modal — handle navigation and selection
		if (modal.type === "select") {
			if (key.name === "return" || key.name === "enter") {
				modal.onSelect(modal.options[selectIndex].value);
			} else if (key.name === "up" || key.name === "k") {
				setSelectIndex((prev) => Math.max(0, prev - 1));
			} else if (key.name === "down" || key.name === "j") {
				setSelectIndex((prev) => Math.min(modal.options.length - 1, prev + 1));
			}
			return;
		}

		// Message modal — Enter to dismiss
		if (modal.type === "message") {
			if (key.name === "return" || key.name === "enter") {
				modal.onDismiss();
			}
		}

		// Confirm modal — Enter to confirm
		if (modal.type === "confirm") {
			if (key.name === "return" || key.name === "enter") {
				modal.onConfirm();
			}
		}
	});

	if (!modal) {
		return null;
	}

	const renderModal = () => {
		switch (modal.type) {
			case "confirm":
				return (
					<ConfirmModal
						title={modal.title}
						message={modal.message}
						onConfirm={modal.onConfirm}
						onCancel={modal.onCancel}
					/>
				);

			case "input":
				return (
					<InputModal
						title={modal.title}
						label={modal.label}
						defaultValue={modal.defaultValue}
						onSubmit={modal.onSubmit}
						onCancel={modal.onCancel}
					/>
				);

			case "select":
				return (
					<SelectModal
						title={modal.title}
						message={modal.message}
						options={modal.options}
						defaultIndex={selectIndex}
						onSelect={modal.onSelect}
						onCancel={modal.onCancel}
					/>
				);

			case "message":
				return (
					<MessageModal
						title={modal.title}
						message={modal.message}
						variant={modal.variant}
						onDismiss={modal.onDismiss}
					/>
				);

			case "loading":
				return <LoadingModal message={modal.message} />;

			default:
				return null;
		}
	};

	// Center the modal on screen
	return (
		<box
			position="absolute"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
		>
			{renderModal()}
		</box>
	);
}

export default ModalContainer;
