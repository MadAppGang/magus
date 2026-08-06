// Bypass 4 — the JSX half uses intrinsics the old rule-4 regex never listed. It knew only
// text|box|span, so a file whose ONLY JSX was <scrollbox>/<input>/<select>/<textarea>
// paired with a construct call read as core-only. EXPECT rule 4.
import { Box } from "@opentui/core"

const chrome = Box({ border: true })

export function LogPane() {
  return (
    <scrollbox stickyScroll stickyStart="bottom">
      <input placeholder="filter" />
      <select options={[]} />
      <textarea />
      <ascii-font text="42" />
      <tab-select options={[]} />
      <line-number />
      <code content="x" />
      <markdown content="x" />
      <diff old="a" new="b" />
    </scrollbox>
  )
}
