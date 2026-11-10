import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, writeFileSync, fstatSync, statSync } from "node:fs";
import { join } from "node:path";
import { emptyUserConfig, parseUserConfig, serializeUserConfig, withMultiplexer, type UserConfig } from "./mux-choice";
import { userConfigPath, readUserConfig, writeUserConfig } from "./user-config";
import { sandbox, type Sandbox } from "./process-testdata";

const spaces: Sandbox[] = [];
const space = () => { const s = sandbox(); spaces.push(s); return s; };
afterEach(() => spaces.splice(0).forEach(s => s.cleanup()));
test("[REQ-405] TEST-2201 missing and empty config are explicit unanswered values", () => {
  const empty: UserConfig = { schema: 1, multiplexer: null, multiplexerAnsweredAt: null, extra: {} };
  expect(emptyUserConfig()).toEqual(empty);
  expect(parseUserConfig(null)).toEqual({ ok: true, config: empty });
  expect(parseUserConfig("")).toEqual({ ok: true, config: empty });
  const s = space();
  expect(userConfigPath(s.ctx.stateDir)).toBe(join(s.ctx.stateDir, "config.json"));
  expect(readUserConfig(s.ctx.stateDir)).toEqual({ ok: true, config: empty });
});
for (const value of ["{", "null", "[]", "3", '"config"', "{}", '{"schema":2}', '{"schema":1,"multiplexer":"screen"}',
  '{"schema":1,"multiplexer":4}', '{"schema":1,"multiplexerAnsweredAt":"now"}', '{"schema":1,"multiplexerAnsweredAt":1e999}'])
  test("[REQ-405] TEST-2202 malformed config " + value + " is refused", () => {
    const r = parseUserConfig(value);
    expect(r).toEqual({ ok: false, error: expect.any(String) });
  });
test("[REQ-405] TEST-2203 round trips unknown keys and reserved fields win collisions", () => {
  const text = '{"schema":1,"multiplexer":"tmux","multiplexerAnsweredAt":42,"theme":{"name":"quiet"},"future":[1,true]}';
  const parsed = parseUserConfig(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = withMultiplexer(parsed.config, "herdr", 100);
  expect(next).toEqual({ schema: 1, multiplexer: "herdr", multiplexerAnsweredAt: 100, extra: { theme: { name: "quiet" }, future: [1, true] } });
  expect(parsed.config.multiplexer).toBe("tmux");
  const serialized = serializeUserConfig({ ...next, extra: { ...next.extra, schema: 9, multiplexer: "bad", multiplexerAnsweredAt: -1 } });
  expect(serialized).toBe(JSON.stringify({ schema: 1, multiplexer: "herdr", multiplexerAnsweredAt: 100, theme: { name: "quiet" }, future: [1, true] }, null, 2) + "\n");
  expect(parseUserConfig(serialized)).toEqual({ ok: true, config: next });
  expect(parseUserConfig('{"schema":1}')).toEqual({ ok: true, config: emptyUserConfig() });
});
test("[REQ-405] TEST-2204 replaces whole config without changing an already open reader", () => {
  const s = space(), path = userConfigPath(s.ctx.stateDir);
  const old = serializeUserConfig(withMultiplexer(emptyUserConfig(), "tmux", 1));
  writeFileSync(path, old);
  const fd = openSync(path, "r");
  try {
    writeUserConfig(s.ctx.stateDir, withMultiplexer(emptyUserConfig(), "herdr", 2));
    expect(readFileSync(fd, "utf8")).toBe(old);
    expect(statSync(path).ino).not.toBe(fstatSync(fd).ino);
    expect(readUserConfig(s.ctx.stateDir)).toEqual({ ok: true, config: { schema: 1, multiplexer: "herdr", multiplexerAnsweredAt: 2, extra: {} } });
    expect(readdirSync(s.ctx.stateDir).filter(n => n.includes(".tmp"))).toEqual([]);
  } finally { closeSync(fd); }
});
test("[REQ-405] TEST-2205 unreadable files fail parsing and impossible writes throw", () => {
  const s = space(), path = userConfigPath(s.ctx.stateDir);
  mkdirSync(path);
  expect(readUserConfig(s.ctx.stateDir).ok).toBe(false);
  expect(() => writeUserConfig(s.ctx.stateDir, emptyUserConfig())).toThrow();
  expect(existsSync(path)).toBe(true);
  rmSync(path, { recursive: true });
  writeFileSync(path, "{");
  expect(readUserConfig(s.ctx.stateDir).ok).toBe(false);
});
