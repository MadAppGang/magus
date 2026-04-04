import React, { useState, useEffect, useMemo } from "react";

interface ScrollableListProps<T> {
	/** Array of items to display */
	items: T[];
	/** Currently selected index */
	selectedIndex: number;
	/** Render function for each item */
	renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
	/** Maximum visible height (number of lines) */
	maxHeight: number;
	/** Show scroll indicators */
	showScrollIndicators?: boolean;
	/** Item key extractor */
	getKey?: (item: T, index: number) => string;
}

export function ScrollableList<T>({
	items,
	selectedIndex,
	renderItem,
	maxHeight,
	showScrollIndicators = true,
	getKey,
}: ScrollableListProps<T>) {
	const [scrollOffset, setScrollOffset] = useState(0);

	const hasItemsAbove = scrollOffset > 0;
	const hasItemsBelow = scrollOffset + maxHeight < items.length;
	const indicatorLines =
		(showScrollIndicators && hasItemsAbove ? 1 : 0) +
		(showScrollIndicators && hasItemsBelow ? 1 : 0);
	const effectiveMaxHeight = Math.max(1, maxHeight - indicatorLines);

	// Adjust scroll offset to keep selected item visible
	useEffect(() => {
		if (selectedIndex < scrollOffset) {
			setScrollOffset(selectedIndex);
		} else if (selectedIndex >= scrollOffset + effectiveMaxHeight) {
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

	return (
		<box flexDirection="column">
			{showScrollIndicators && hasItemsAbove && (
				<text fg="cyan">↑ {scrollOffset} more</text>
			)}

			{visibleItems.map(({ item, originalIndex }) => (
				<box
					key={getKey ? getKey(item, originalIndex) : `${originalIndex}`}
					width="100%"
					overflow="hidden"
				>
					{renderItem(item, originalIndex, originalIndex === selectedIndex)}
				</box>
			))}

			{showScrollIndicators && hasItemsBelow && (
				<text fg="cyan">↓ {itemsBelow} more</text>
			)}
		</box>
	);
}

export default ScrollableList;
