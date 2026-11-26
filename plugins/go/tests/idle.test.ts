import { expect, test } from "bun:test";
import { IdleTracker } from "../language-server/src/idle.ts";

function clock(ms = 100, start = 500) {
  let now = start;
  return { tracker: new IdleTracker(ms, () => now), at: (time: number) => { now = time; } };
}

test("REQ-3 idle window begins at wrapper start and includes the exact deadline", () => {
  const { tracker, at } = clock();
  expect(tracker.remainingMs()).toBe(100);
  at(599);
  expect(tracker.candidate()).toBeNull();
  at(600);
  expect(tracker.remainingMs()).toBe(0);
  const mark = tracker.candidate();
  expect(mark).not.toBeNull();
  expect(tracker.recheck(mark!)).toBe(true);
});

test("REQ-3 every raw chunk restarts the idle window before parsing", () => {
  const { tracker, at } = clock();
  at(590);
  tracker.chunk();
  at(600);
  expect(tracker.remainingMs()).toBe(90);
  expect(tracker.candidate()).toBeNull();
  at(690);
  expect(tracker.candidate()).not.toBeNull();
});

test("REQ-3 only the last matching response restarts the idle window", () => {
  const { tracker, at } = clock();
  tracker.request("1");
  tracker.request('"1"');
  at(650);
  tracker.response("2");
  expect(tracker.pendingCount).toBe(2);
  tracker.response("1");
  expect(tracker.pendingCount).toBe(1);
  expect(tracker.candidate()).toBeNull();
  at(700);
  tracker.response('"1"');
  expect(tracker.pendingCount).toBe(0);
  expect(tracker.remainingMs()).toBe(100);
  at(799);
  expect(tracker.candidate()).toBeNull();
  at(800);
  expect(tracker.candidate()).not.toBeNull();
});

test("REQ-3 a partial client frame blocks idle even after the deadline", () => {
  const { tracker, at } = clock();
  tracker.setPartial(true);
  at(700);
  expect(tracker.candidate()).toBeNull();
  tracker.setPartial(false);
  expect(tracker.candidate()).not.toBeNull();
});

test("REQ-3 idle-chunk-on-recheck-cancels even if a full new window has elapsed", () => {
  const { tracker, at } = clock();
  at(600);
  const mark = tracker.candidate();
  expect(mark).not.toBeNull();
  tracker.chunk();
  at(700);
  expect(tracker.candidate()).not.toBeNull();
  expect(tracker.recheck(mark!)).toBe(false);
});

test("REQ-3 a request or partial frame at recheck blocks the idle stop", () => {
  const { tracker, at } = clock();
  at(600);
  const mark = tracker.candidate()!;
  tracker.setPartial(true);
  expect(tracker.recheck(mark)).toBe(false);
  tracker.setPartial(false);
  tracker.request("1");
  expect(tracker.recheck(mark)).toBe(false);
});

test("REQ-3 zero and permanent disable both prevent idle", () => {
  for (const ms of [0, 100]) {
    const { tracker, at } = clock(ms);
    if (ms) tracker.disable();
    tracker.chunk();
    at(1000);
    expect(tracker.enabled).toBe(false);
    expect(tracker.remainingMs()).toBeNull();
    expect(tracker.candidate()).toBeNull();
  }
});
