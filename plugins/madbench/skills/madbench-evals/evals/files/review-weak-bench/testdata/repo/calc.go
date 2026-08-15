package calc

// Divide returns a divided by b.
//
// THE BUG: b == 0 panics with a runtime integer-divide-by-zero instead of
// reporting the problem to the caller. The scenario asks the agent to return
// an error instead.
func Divide(a, b int) int {
	return a / b
}
