import { jsx as _jsx } from "@opentui/react/jsx-runtime";
import { createContext, useContext, useState, } from "react";
// ============================================================================
// Context
// ============================================================================
const AnimationContext = createContext(null);
export function AnimationProvider({ children }) {
    const [timelines, setTimelines] = useState(new Map());
    const registerTimeline = (id, timeline) => {
        setTimelines((prev) => {
            const next = new Map(prev);
            next.set(id, timeline);
            return next;
        });
    };
    const unregisterTimeline = (id) => {
        setTimelines((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
        });
    };
    return (_jsx(AnimationContext.Provider, { value: { timelines, registerTimeline, unregisterTimeline }, children: children }));
}
// ============================================================================
// Hook: useAnimation
// ============================================================================
export function useAnimation() {
    const context = useContext(AnimationContext);
    if (!context) {
        throw new Error("useAnimation must be used within an AnimationProvider");
    }
    return context;
}
