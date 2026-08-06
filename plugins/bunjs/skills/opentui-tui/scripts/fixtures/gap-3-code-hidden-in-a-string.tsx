// KNOWN GAP — and the exact price of a property worth paying for. `clean-strings-and-comments.tsx`
// requires that a construct call spelled inside a string is NOT a violation, so that documentation
// can name the form it forbids. `eval` and `new Function` turn a string back into code, and the
// parser cannot know which strings those are.
//
// Unclosable without giving up the property, and the property matters more: the mandated surface
// banner in every React reference quotes `Text({…})` in order to ban it. EXPECT known gap.
const chrome = eval("Box({ border: true })")
const label = new Function("Text", "return Text({ content: 'x' })")

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
