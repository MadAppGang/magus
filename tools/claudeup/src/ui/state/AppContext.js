import { jsx as _jsx } from "@opentui/react/jsx-runtime";
import { createContext, useContext, useReducer, } from "react";
import { appReducer, initialState } from "./reducer.js";
// ============================================================================
// Context
// ============================================================================
const AppContext = createContext(null);
export function AppProvider({ children, initialProjectPath, }) {
    const [state, dispatch] = useReducer(appReducer, {
        ...initialState,
        projectPath: initialProjectPath || process.cwd(),
    });
    return (_jsx(AppContext.Provider, { value: { state, dispatch }, children: children }));
}
// ============================================================================
// Hook: useApp
// ============================================================================
export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error("useApp must be used within an AppProvider");
    }
    return context;
}
// ============================================================================
// Hook: useNavigation
// ============================================================================
export function useNavigation() {
    const { state, dispatch } = useApp();
    return {
        currentRoute: state.currentRoute,
        currentScreen: state.currentRoute.screen,
        navigateTo: (route) => {
            dispatch({ type: "NAVIGATE", route });
        },
        navigateToScreen: (screen) => {
            dispatch({ type: "NAVIGATE", route: { screen } });
        },
    };
}
// ============================================================================
// Hook: useModal
// ============================================================================
export function useModal() {
    const { dispatch } = useApp();
    return {
        showModal: (modal) => {
            dispatch({ type: "SHOW_MODAL", modal });
        },
        hideModal: () => {
            dispatch({ type: "HIDE_MODAL" });
        },
        confirm: (title, message) => {
            return new Promise((resolve) => {
                dispatch({
                    type: "SHOW_MODAL",
                    modal: {
                        type: "confirm",
                        title,
                        message,
                        onConfirm: () => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(true);
                        },
                        onCancel: () => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(false);
                        },
                    },
                });
            });
        },
        input: (title, label, defaultValue) => {
            return new Promise((resolve) => {
                dispatch({
                    type: "SHOW_MODAL",
                    modal: {
                        type: "input",
                        title,
                        label,
                        defaultValue,
                        onSubmit: (value) => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(value);
                        },
                        onCancel: () => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(null);
                        },
                    },
                });
            });
        },
        select: (title, message, options, defaultIndex) => {
            return new Promise((resolve) => {
                dispatch({
                    type: "SHOW_MODAL",
                    modal: {
                        type: "select",
                        title,
                        message,
                        options,
                        defaultIndex,
                        onSelect: (value) => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(value);
                        },
                        onCancel: () => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve(null);
                        },
                    },
                });
            });
        },
        message: (title, message, variant = "info") => {
            return new Promise((resolve) => {
                dispatch({
                    type: "SHOW_MODAL",
                    modal: {
                        type: "message",
                        title,
                        message,
                        variant,
                        onDismiss: () => {
                            dispatch({ type: "HIDE_MODAL" });
                            resolve();
                        },
                    },
                });
            });
        },
        loading: (message) => {
            dispatch({
                type: "SHOW_MODAL",
                modal: {
                    type: "loading",
                    message,
                },
            });
        },
    };
}
// ============================================================================
// Hook: useProgress
// ============================================================================
export function useProgress() {
    const { state, dispatch } = useApp();
    return {
        progress: state.progress,
        isVisible: state.progress !== null,
        show: (message, current, total) => {
            dispatch({ type: "SHOW_PROGRESS", state: { message, current, total } });
        },
        update: (state) => {
            dispatch({ type: "UPDATE_PROGRESS", state });
        },
        hide: () => {
            dispatch({ type: "HIDE_PROGRESS" });
        },
    };
}
