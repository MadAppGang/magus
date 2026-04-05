import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { useState, useEffect } from "react";
/**
 * A scrollable detail panel that renders an array of lines
 * with automatic scroll tracking. When content exceeds maxHeight,
 * it shows a scroll indicator and clips to fit.
 */
export function ScrollableDetail({ lines, maxHeight, scrollTrigger = 0, }) {
    const [scrollOffset, setScrollOffset] = useState(0);
    // Reset scroll when content changes (new item selected)
    useEffect(() => {
        setScrollOffset(0);
    }, [scrollTrigger]);
    const totalLines = lines.length;
    const visibleLines = Math.max(1, maxHeight - 1); // -1 for scroll indicator
    const canScroll = totalLines > visibleLines;
    const maxOffset = Math.max(0, totalLines - visibleLines);
    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const visibleContent = lines.slice(clampedOffset, clampedOffset + visibleLines);
    const scrollUp = clampedOffset > 0;
    const scrollDown = clampedOffset < maxOffset;
    return (_jsxs("box", { flexDirection: "column", children: [scrollUp && (_jsx("box", { children: _jsxs("text", { fg: "cyan", children: ["\u2191 ", clampedOffset, " more"] }) })), visibleContent, scrollDown && (_jsx("box", { children: _jsxs("text", { fg: "cyan", children: ["\u2193 ", totalLines - clampedOffset - visibleLines, " more"] }) }))] }));
}
