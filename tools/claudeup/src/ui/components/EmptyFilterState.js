import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
export function EmptyFilterState({ query, entityName = "items", }) {
    return (_jsxs("box", { flexDirection: "column", marginTop: 2, paddingLeft: 2, paddingRight: 2, children: [_jsxs("text", { fg: "yellow", children: ["No ", entityName, " found for \"", query, "\""] }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "gray", children: "Try a different search term, or if you think" }) }), _jsx("text", { fg: "gray", children: "this is a bug, report it at:" }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "#5c9aff", children: "github.com/MadAppGang/magus/issues" }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "gray", children: "Press Esc to clear the filter." }) })] }));
}
