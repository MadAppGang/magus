import { jsx as _jsx } from "@opentui/react/jsx-runtime";
import { createContext, useContext, useState, useEffect } from "react";
import { useRenderer, useOnResize } from "@opentui/react";
const DimensionsContext = createContext(null);
// Fixed heights for layout elements
const SCREEN_HEADER_HEIGHT = 4; // ScreenLayout: border + title row + status/search row + border
const SCREEN_FOOTER_HEIGHT = 2; // ScreenLayout: border-top + footer content
const APP_MARGINS = 1; // buffer for margins/padding
const PROGRESS_HEIGHT = 1; // when visible
function calculateDimensions(columns, rows, showProgress, showDebug, showUpdateBanner) {
    const terminalWidth = columns;
    const terminalHeight = rows;
    // Calculate total available height for ScreenLayout (includes its header, panels, footer)
    let contentHeight = terminalHeight - APP_MARGINS;
    if (showProgress)
        contentHeight -= PROGRESS_HEIGHT;
    if (showDebug)
        contentHeight -= 1;
    if (showUpdateBanner)
        contentHeight -= 1;
    contentHeight = Math.max(10, contentHeight); // Minimum 10 lines for full layout
    // Calculate available content width (accounting for padding)
    const contentWidth = Math.max(40, terminalWidth - 4);
    // Calculate list panel height for ScrollableList
    // ScreenLayout uses: panelHeight = contentHeight - 4 (header) - 1 (footer)
    // The ScrollableList sits inside the panel
    const listPanelHeight = Math.max(3, contentHeight - SCREEN_HEADER_HEIGHT - SCREEN_FOOTER_HEIGHT);
    return {
        terminalWidth,
        terminalHeight,
        contentHeight,
        contentWidth,
        listPanelHeight,
    };
}
export function DimensionsProvider({ children, showProgress = false, showDebug = false, showUpdateBanner = false, }) {
    const renderer = useRenderer();
    const [dimensions, setDimensions] = useState(() => calculateDimensions(renderer.width, renderer.height, showProgress, showDebug, showUpdateBanner));
    // Handle terminal resize
    useOnResize((width, height) => {
        setDimensions(calculateDimensions(width, height, showProgress, showDebug, showUpdateBanner));
    });
    // Update when showProgress/showDebug/showUpdateBanner changes
    useEffect(() => {
        setDimensions(calculateDimensions(renderer.width, renderer.height, showProgress, showDebug, showUpdateBanner));
    }, [
        renderer.width,
        renderer.height,
        showProgress,
        showDebug,
        showUpdateBanner,
    ]);
    return (_jsx(DimensionsContext.Provider, { value: dimensions, children: children }));
}
export function useDimensions() {
    const context = useContext(DimensionsContext);
    if (!context) {
        // Return sensible defaults if used outside provider
        return {
            terminalWidth: 80,
            terminalHeight: 24,
            contentHeight: 23, // 24 - 1 margin
            contentWidth: 76,
            listPanelHeight: 17, // 23 - 4 header - 2 footer
        };
    }
    return context;
}
export default DimensionsContext;
