import { jsx as _jsx } from "@opentui/react/jsx-runtime";
/**
 * StyledText - Utility component to simplify text styling with OpenTUI
 *
 * Converts props to nested tag pattern required by OpenTUI.
 *
 * Example:
 *   <StyledText bold color="green">Success</StyledText>
 *   becomes: <text fg="green"><strong>Success</strong></text>
 */
export function StyledText({ children, bold = false, color, bgColor, dim = false, italic = false, underline = false, inverse = false, }) {
    let content = children;
    // Apply text modifiers (innermost to outermost)
    if (bold) {
        content = _jsx("strong", { children: content });
    }
    if (italic) {
        content = _jsx("em", { children: content });
    }
    if (underline) {
        content = _jsx("u", { children: content });
    }
    // Note: dim and inverse use span with colors since OpenTUI doesn't have these as React elements
    if (dim) {
        content = _jsx("span", { fg: "#666666", children: content });
    }
    if (inverse) {
        // Inverse effect approximated with contrasting colors
        content = (_jsx("span", { fg: "black", bg: "white", children: content }));
    }
    // Apply colors (outer layer)
    const textProps = {};
    if (color)
        textProps.fg = color;
    if (bgColor)
        textProps.bg = bgColor;
    return _jsx("text", { ...textProps, children: content });
}
export default StyledText;
