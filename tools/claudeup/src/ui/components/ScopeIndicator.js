import { jsx as _jsx } from "@opentui/react/jsx-runtime";
/**
 * Scope indicator for list items.
 * Shows colored letter badges when installed, empty space when not.
 *
 * Installed in user+project:  u p
 * Installed in project only:    p
 * Not installed:              (3 spaces)
 *
 * Colors match the detail panel: cyan=user, green=project, yellow=local
 */
export function scopeIndicatorText(user, project, local) {
    const segments = [
        user
            ? { char: "u", bg: "cyan", fg: "black" }
            : { char: " ", bg: "", fg: "" },
        project
            ? { char: "p", bg: "green", fg: "black" }
            : { char: " ", bg: "", fg: "" },
        local
            ? { char: "l", bg: "yellow", fg: "black" }
            : { char: " ", bg: "", fg: "" },
    ];
    const text = segments.map((s) => s.char).join("");
    return { text, segments };
}
export function ScopeIndicator({ user, project, local }) {
    const { segments } = scopeIndicatorText(user, project, local);
    return (_jsx("text", { children: segments.map((s, i) => s.bg ? (_jsx("span", { bg: s.bg, fg: s.fg, children: s.char }, i)) : (_jsx("span", { children: " " }, i))) }));
}
