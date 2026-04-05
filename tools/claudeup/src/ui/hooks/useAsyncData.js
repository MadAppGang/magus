import { useState, useEffect, useCallback } from "react";
/**
 * Hook for fetching async data with loading/error states
 */
export function useAsyncData({ fetcher, deps = [], immediate = true, }) {
    const [data, setData] = useState({ status: "idle" });
    const refetch = useCallback(async () => {
        setData({ status: "loading" });
        try {
            const result = await fetcher();
            setData({ status: "success", data: result });
        }
        catch (err) {
            setData({
                status: "error",
                error: err instanceof Error ? err : new Error(String(err)),
            });
        }
    }, [fetcher]);
    useEffect(() => {
        if (immediate) {
            refetch();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return {
        data,
        isLoading: data.status === "loading",
        isSuccess: data.status === "success",
        isError: data.status === "error",
        error: data.status === "error" ? data.error : null,
        refetch,
        value: data.status === "success" ? data.data : null,
    };
}
/**
 * Hook for fetching async data with debounced query
 */
export function useDebouncedAsyncData({ fetcher, query, debounceMs = 300, minQueryLength = 1, }) {
    const [data, setData] = useState({ status: "idle" });
    const refetch = useCallback(async () => {
        if (query.length < minQueryLength) {
            setData({ status: "idle" });
            return;
        }
        setData({ status: "loading" });
        try {
            const result = await fetcher(query);
            setData({ status: "success", data: result });
        }
        catch (err) {
            setData({
                status: "error",
                error: err instanceof Error ? err : new Error(String(err)),
            });
        }
    }, [fetcher, query, minQueryLength]);
    useEffect(() => {
        if (query.length < minQueryLength) {
            setData({ status: "idle" });
            return;
        }
        const timeoutId = setTimeout(() => {
            refetch();
        }, debounceMs);
        return () => clearTimeout(timeoutId);
    }, [query, debounceMs, minQueryLength, refetch]);
    return {
        data,
        isLoading: data.status === "loading",
        isSuccess: data.status === "success",
        isError: data.status === "error",
        error: data.status === "error" ? data.error : null,
        refetch,
        value: data.status === "success" ? data.data : null,
    };
}
