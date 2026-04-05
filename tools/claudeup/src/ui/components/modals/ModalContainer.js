import { jsx as _jsx } from "@opentui/react/jsx-runtime";
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
    // Handle ALL keyboard events for modals
    useKeyboard((key) => {
        if (!modal)
            return;
        if (modal.type === "loading")
            return;
        // Escape — close any modal
        if (key.name === "escape" || key.name === "q") {
            if (modal.type === "confirm")
                modal.onCancel();
            else if (modal.type === "input")
                modal.onCancel();
            else if (modal.type === "select")
                modal.onCancel();
            else if (modal.type === "message")
                modal.onDismiss();
            return;
        }
        // Select modal — handle navigation and selection
        if (modal.type === "select") {
            if (key.name === "return" || key.name === "enter") {
                modal.onSelect(modal.options[selectIndex].value);
            }
            else if (key.name === "up" || key.name === "k") {
                setSelectIndex((prev) => Math.max(0, prev - 1));
            }
            else if (key.name === "down" || key.name === "j") {
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
    });
    if (!modal) {
        return null;
    }
    const renderModal = () => {
        switch (modal.type) {
            case "confirm":
                return (_jsx(ConfirmModal, { title: modal.title, message: modal.message, onConfirm: modal.onConfirm, onCancel: modal.onCancel }));
            case "input":
                return (_jsx(InputModal, { title: modal.title, label: modal.label, defaultValue: modal.defaultValue, onSubmit: modal.onSubmit, onCancel: modal.onCancel }));
            case "select":
                return (_jsx(SelectModal, { title: modal.title, message: modal.message, options: modal.options, defaultIndex: selectIndex, onSelect: modal.onSelect, onCancel: modal.onCancel }));
            case "message":
                return (_jsx(MessageModal, { title: modal.title, message: modal.message, variant: modal.variant, onDismiss: modal.onDismiss }));
            case "loading":
                return _jsx(LoadingModal, { message: modal.message });
            default:
                return null;
        }
    };
    // Center the modal on screen
    return (_jsx("box", { position: "absolute", width: "100%", height: "100%", justifyContent: "center", alignItems: "center", children: renderModal() }));
}
export default ModalContainer;
