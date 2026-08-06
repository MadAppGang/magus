// Bypass 7 — baseline coverage that must not regress. EXPECT rules 2, 3, 5.
// rule 2: capitalized form of a kebab intrinsic. rule 3: Solid's snake_case in a React file.
// rule 5: `content=` on <text> — it compiles, and it is still the core spelling.
export function Panel() {
  return (
    <box>
      <ScrollBox />
      <TabSelect options={[]} />
      <AsciiFont text="42" />
      <LineNumber />
      <ascii_font text="42" />
      <tab_select options={[]} />
      <line_number />
      <scroll_box />
      <text content="should be children" />
    </box>
  )
}
