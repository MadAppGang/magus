import { useKeyboard as useOpenTUIKeyboard } from "@opentui/react";
/**
 * Simple re-export of OpenTUI's useKeyboard hook
 * Used by modals for direct keyboard event handling
 *
 * Key names in OpenTUI:
 * - Single characters: "a", "1", etc.
 * - Arrow keys: "up", "down", "left", "right"
 * - Special: "enter", "escape", "tab", "backspace", "delete"
 */
export function useKeyboard(handler) {
    useOpenTUIKeyboard(handler);
}
