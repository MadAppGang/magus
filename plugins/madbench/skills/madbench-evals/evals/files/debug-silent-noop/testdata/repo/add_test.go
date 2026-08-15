package add

import "testing"

// Add is not defined anywhere in this package — that is the point. The bench
// seeds this directory in a RED state, so `go test ./...` fails to build until
// the agent writes add.go. A no-op run cannot pass.
func TestAdd(t *testing.T) {
	cases := []struct {
		name string
		a, b int
		want int
	}{
		{"positives", 2, 3, 5},
		{"with zero", 7, 0, 7},
		{"negatives", -4, -6, -10},
		{"mixed signs", -5, 12, 7},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Add(tc.a, tc.b); got != tc.want {
				t.Errorf("Add(%d, %d) = %d, want %d", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
