import { expect } from "claude-code/testing";
import { test } from "./kit";
import type { OrchestratorRecord as PublicRecord } from "../types";
import { parseRecord } from "../scripts/lib/state-core";
import { record, taskRows, NOW } from "./testdata";

test("[REQ-4; §4.8] TEST-1601 [§4.8] public mod and Bun record shapes agree through the wire files", () => {
  const expected: PublicRecord = record({
    tasks: taskRows(), deps: [{ kind: "release", ref: "api 2.0", since: NOW, doneAt: null, note: "publication" }],
    holds: [{ what: "staging", since: NOW }], blocked: { reason: "choose", since: NOW },
  });
  const { rev, tasks, deps, holds, blocked, state, doneAt, ...identity } = expected;
  const parsed: PublicRecord | null = parseRecord(JSON.stringify(identity), JSON.stringify({
    schema: 1, key: expected.key, updatedAt: expected.updatedAt,
    rev, tasks, deps, holds, blocked, state, doneAt,
  }));
  expect(parsed).toEqual(expected);
});
