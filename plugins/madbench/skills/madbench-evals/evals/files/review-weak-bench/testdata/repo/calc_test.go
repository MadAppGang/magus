package calc

import "testing"

// This test targets the FIXED signature — Divide reporting a zero divisor as an
// error rather than panicking. Against the seeded calc.go it does not compile,
// so the package is RED until the agent does the work.
//
// The bench as shipped never runs this: it grades only with llm-rubric and a
// step-count check. That is the weakness the review scenario exists to catch —
// a reviewer who adds `exec: go test ./...` gets a real outcome check for free.
func TestDivide(t *testing.T) {
	got, err := Divide(10, 2)
	if err != nil {
		t.Fatalf("Divide(10, 2) returned error %v, want none", err)
	}
	if got != 5 {
		t.Errorf("Divide(10, 2) = %d, want 5", got)
	}

	if _, err := Divide(1, 0); err == nil {
		t.Error("Divide(1, 0) returned no error, want a zero-divisor error")
	}
}
