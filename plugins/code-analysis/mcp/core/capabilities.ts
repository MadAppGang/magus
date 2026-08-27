/**
 * capabilities.ts — the vocabulary of what an engine can genuinely do.
 *
 * A capability is an operation with a real answer, not an approximation of one:
 * a text or vector guess at a structural question is NOT the capability. That
 * distinction is what lets the tool list shrink honestly instead of degrading
 * silently, so nothing here may be widened to "sort of".
 *
 * Imports nothing, by contract. Every other file in core/ may depend on this one.
 */

export type Capability =
  | "generalSearch" // free-form query -> ranked locations.  ALWAYS present.
  | "knowledgeSearch" // docs, markdown, comments, non-code entities
  | "locateSymbol" // name -> definition location
  | "readSource" // return verbatim body
  | "findDependencies" // what does X depend on
  | "findDependents" // what depends on X / callers
  | "callTree" // transitive call paths, not just direct edges
  | "findImplementations" // interface/abstract -> concrete impls
  | "impact"; // blast radius of changing X

export type CapabilityStatus =
  | { ready: true }
  | { ready: false; reason: string; remedy?: string; retryable: boolean };

/**
 * Iteration order for Record<Capability, …>. A union type cannot be enumerated at
 * runtime, and BackendHealth.capabilities is exactly that Record.
 *
 * The order is also the render and listing order, so it is stable by contract:
 * a test that asserts a capability list compares arrays, not sets.
 */
export const CAPABILITIES: readonly Capability[] = [
  "generalSearch",
  "knowledgeSearch",
  "locateSymbol",
  "readSource",
  "findDependencies",
  "findDependents",
  "callTree",
  "findImplementations",
  "impact",
];
