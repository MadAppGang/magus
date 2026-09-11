// Every export of this file is in scope, by name, in every `metrics:` expression of the
// bench beside it. Arithmetic that outgrows one line belongs here, not in a sibling script.
export function percent(score: number): number {
  return Math.round(score * 100);
}
