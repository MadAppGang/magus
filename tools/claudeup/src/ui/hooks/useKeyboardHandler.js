import { useKeyboard as useOpenTUIKeyboard } from "@opentui/react";
/**
 * useKeyboardHandler hook
 * Provides Ink-like API for keyboard events
 *
 * @param handler - Callback function with Ink-compatible signature
 *
 * @example
 * ```tsx
 * useKeyboardHandler((input, key) => {
 *   if (key.return) handleEnter();
 *   if (key.upArrow) handleUp();
 *   if (key.escape) handleEscape();
 *   if (input === 'q') handleQuit();
 * });
 * ```
 */
export function useKeyboardHandler(handler) {
    useOpenTUIKeyboard((event) => {
        // Map OpenTUI key names to Ink-like key names
        const key = {
            name: event.name,
            ctrl: event.ctrl || false,
            shift: event.shift || false,
            meta: event.meta || false,
            return: event.name === "enter" || event.name === "return",
            upArrow: event.name === "up",
            downArrow: event.name === "down",
            leftArrow: event.name === "left",
            rightArrow: event.name === "right",
            escape: event.name === "escape",
            tab: event.name === "tab",
        };
        // For printable characters, pass the character as input
        // For special keys, pass empty string
        const input = event.name.length === 1 ? event.name : "";
        handler(input, key);
    });
}
