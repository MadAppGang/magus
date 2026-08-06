// Bypass 18 (found here, not reported) — the React surface WITHOUT JSX syntax, in a plain .ts file.
// Every rule that hunted for `<box` was really hunting for one spelling of `createElement("box")`.
// The compiled form of an intrinsic is still the React surface, and it still cannot share a module
// with a construct call. The jsx-runtime spellings (`jsx`, `jsxs`, `jsxDEV`) count too. EXPECT rule 4.
import { createElement } from "react"
import { Box } from "@opentui/core"

const chrome = Box({ border: true })
const tree = createElement("box", { flexDirection: "column" }, createElement("text", null, "hello"))

export const mounted = { chrome, tree }
