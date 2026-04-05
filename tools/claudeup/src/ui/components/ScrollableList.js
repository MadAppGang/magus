import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { useState, useEffect, useMemo } from "react";
export function ScrollableList({ items, selectedIndex, renderItem, maxHeight, showScrollIndicators = true, getKey, }) {
    const [scrollOffset, setScrollOffset] = useState(0);
    const hasItemsAbove = scrollOffset > 0;
    const hasItemsBelow = scrollOffset + maxHeight < items.length;
    const indicatorLines = (showScrollIndicators && hasItemsAbove ? 1 : 0) +
        (showScrollIndicators && hasItemsBelow ? 1 : 0);
    const effectiveMaxHeight = Math.max(1, maxHeight - indicatorLines);
    // Adjust scroll offset to keep selected item visible
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        }
        else if (selectedIndex >= scrollOffset + effectiveMaxHeight) {
            setScrollOffset(selectedIndex - effectiveMaxHeight + 1);
        }
    }, [selectedIndex, effectiveMaxHeight, scrollOffset]);
    // Reset scroll when items change drastically (e.g. search)
    useEffect(() => {
        if (scrollOffset >= items.length) {
            setScrollOffset(Math.max(0, items.length - effectiveMaxHeight));
        }
    }, [items.length, scrollOffset, effectiveMaxHeight]);
    const visibleItems = useMemo(() => {
        const start = scrollOffset;
        const end = Math.min(scrollOffset + effectiveMaxHeight, items.length);
        return items.slice(start, end).map((item, idx) => ({
            item,
            originalIndex: start + idx,
        }));
    }, [items, scrollOffset, effectiveMaxHeight]);
    const itemsBelow = items.length - scrollOffset - effectiveMaxHeight;
    return (_jsxs("box", { flexDirection: "column", children: [showScrollIndicators && hasItemsAbove && (_jsxs("text", { fg: "cyan", children: ["\u2191 ", scrollOffset, " more"] })), visibleItems.map(({ item, originalIndex }) => (_jsx("box", { width: "100%", overflow: "hidden", children: renderItem(item, originalIndex, originalIndex === selectedIndex) }, getKey ? getKey(item, originalIndex) : `${originalIndex}`))), showScrollIndicators && hasItemsBelow && (_jsxs("text", { fg: "cyan", children: ["\u2193 ", itemsBelow, " more"] }))] }));
}
export default ScrollableList;
