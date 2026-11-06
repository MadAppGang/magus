import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  parseArgs,
  mainCheckoutFromCommonDir,
  buildLaunchLine,
  lockPathFor,
  stateDir,
  isClaudeForeground,
  promptStillInInput,
  lockIsStale,
} from "./window";

type Environment = Readonly<Record<string, string | undefined>>;

function startArgv(...extra: string[]): string[] {
  return ["--name", "review", "--colour", "blue", ...extra];
}

function expectParseError(
  argv: readonly string[],
  env: Environment = {},
): void {
  const result = parseArgs(argv, env);

  if (result.ok) {
    throw new Error("Expected argument rejection: " + JSON.stringify(argv));
  }
  expect(result).toEqual({ ok: false, error: expect.any(String) });
  expect(result.error.trim()).not.toBe("");
  expect(result.error).not.toMatch(/[\r\n]/);
}

function invalidLaunchCommands(): string[] {
  return [
    "",
    " wt",
    "wt ",
    "wt  --quiet",
    "wt\t--quiet",
    "wt\n--quiet",
    "wt; printf unsafe",
    "wt && true",
    "wt | other",
    "wt > output",
    "$(whoami)",
    "~/bin/$LAUNCH",
    "'wt'",
    'wt --label="two words"',
    "MODE=quiet wt",
  ];
}

function shellWord(value: string): string {
  const literal = value.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const quoted = "(?:'" + literal + "'|\"" + literal + "\")";

  return /\s/.test(value) ? quoted : "(?:" + literal + "|" + quoted + ")";
}

function defaultLaunchPrefix(name: string, colour: string): string {
  return (
    "CLAUDE_WT_NAME=" + shellWord(name) +
    "\\s+CLAUDE_WT_COLOUR=" + shellWord(colour) +
    "\\s+claude\\s+-w\\s+" + shellWord(name) +
    "\\s+-n\\s+" + shellWord(name)
  );
}

function expectLaunchLine(line: string, expectedCommand: string): void {
  // The warning's wording is free apart from the specified continuation notice.
  const guard = /git\s+pull\s+--ff-only\s*&&\s*\{\s*!\s*command\s+-v\s+magus\s*>\s*\/dev\/null\s+2>&1\s*\|\|\s*magus\s+update\s*\|\|\s*echo\s+(?:"[^"\r\n]*continuing[^"\r\n]*"|'[^'\r\n]*continuing[^'\r\n]*')\s*;\s*\}\s*&&\s*/.source;

  expect(line).toMatch(new RegExp("^" + guard + expectedCommand + "\\s*$"));
}

describe("start and delivery arguments", () => {
  test("TEST-1 [REQ-1, REQ-2, REQ-3] returns start defaults when only required flags are supplied", () => {
    const argv = startArgv();

    const result = parseArgs(argv, {});

    expect(result).toEqual({
      ok: true,
      args: {
        mode: "start",
        name: "review",
        colour: "blue",
        prompt: "",
        noWait: false,
        dryRun: false,
      },
    });
  });

  test("TEST-2 [REQ-1, REQ-2] accepts valid name boundaries and all nine colours through either alias", () => {
    const cases = [
      ["a", "red"],
      ["0", "blue"],
      ["a".repeat(48), "green"],
      ["repo.2_name-branch", "yellow"],
      ["review", "purple"],
      ["review", "orange"],
      ["review", "pink"],
      ["review", "cyan"],
      ["review", "default"],
    ] as const;

    for (const [name, colour] of cases) {
      for (const flag of ["--colour", "--color"]) {
        const result = parseArgs(["--name", name, flag, colour], {});

        expect(result).toEqual({
          ok: true,
          args: {
            mode: "start",
            name,
            colour,
            prompt: "",
            noWait: false,
            dryRun: false,
          },
        });
      }
    }
  });

  test("TEST-3 [REQ-3, REQ-4, REQ-6] preserves explicit start values and consumes the next argument literally", () => {
    const dir = join(tmpdir(), "orchestrator-window-testdata", "repo with spaces");
    const prompt = "First line\n--literal-option";

    const result = parseArgs(startArgv(
      "--prompt", prompt,
      "--dir", dir,
      "--session", "development session",
      "--split", "%7",
      "--model", "Model_9.2-X",
      "--effort", "unlisted",
      "--launch", "env MODE=quiet ./launch-session",
      "--no-wait",
      "--dry-run",
    ), {});

    expect(result).toEqual({
      ok: true,
      args: {
        mode: "start",
        name: "review",
        colour: "blue",
        prompt,
        dir,
        session: "development session",
        split: "%7",
        model: "Model_9.2-X",
        effort: "unlisted",
        launch: "env MODE=quiet ./launch-session",
        noWait: true,
        dryRun: true,
      },
    });

    const literalValues = [
      { flag: "--prompt", value: "", field: "prompt" },
      { flag: "--prompt", value: "--dry-run", field: "prompt" },
      { flag: "--dir", value: "--session", field: "dir" },
      { flag: "--session", value: "--split", field: "session" },
      { flag: "--split", value: "--model", field: "split" },
    ];

    for (const { flag, value, field } of literalValues) {
      expect(parseArgs(startArgv(flag, value), {})).toEqual({
        ok: true,
        args: {
          mode: "start",
          name: "review",
          colour: "blue",
          prompt: "",
          noWait: false,
          dryRun: false,
          [field]: value,
        },
      });
    }
  });

  test("TEST-4 [REQ-1, REQ-2, REQ-5] returns a one-line error for missing, unknown, positional or repeated arguments", () => {
    const malformed = [
      [],
      ["--name", "review"],
      ["--colour", "blue"],
      ["--name"],
      ["--colour"],
      ["--color"],
      ["--project", "example"],
      startArgv("--unknown"),
      startArgv("unexpected"),
      ["unexpected", ...startArgv()],
      startArgv("--name=another"),
      startArgv("--name", "another"),
      startArgv("--colour", "red"),
      startArgv("--color", "red"),
      ["--name", "review", "--color", "red", "--colour", "blue"],
      startArgv("--dry-run", "--dry-run"),
      startArgv("--no-wait", "--no-wait"),
    ];

    for (const argv of malformed) {
      expectParseError(argv);
    }

    const valueFlags = [
      ["--prompt", "text"],
      ["--dir", "checkout"],
      ["--session", "development"],
      ["--split", "%7"],
      ["--model", "model-2"],
      ["--effort", "high"],
      ["--launch", "wt"],
    ] as const;

    for (const [flag, value] of valueFlags) {
      expectParseError(startArgv(flag));
      expectParseError(startArgv(flag, value, flag, value));
    }
  });

  test("TEST-5 [REQ-1, REQ-2, REQ-6] rejects invalid names, colours, routing values, models and efforts", () => {
    const invalidNames = [
      "", "a".repeat(49), "Review", ".review", "_review", "-review",
      "repo/name", "name with space", "name\nnext", "name;printf",
    ];

    for (const name of invalidNames) {
      expectParseError(["--name", name, "--colour", "blue"]);
    }

    for (const colour of ["", "Red", "magenta", "default ", "red;printf"]) {
      expectParseError(["--name", "review", "--colour", colour]);
    }

    for (const flag of ["--dir", "--session", "--split"]) {
      expectParseError(startArgv(flag, ""));
    }

    for (const model of [
      "", ".model", "_model", "-model", "model/route",
      "model name", "model:tag", "model;printf", "m\nx",
    ]) {
      expectParseError(startArgv("--model", model));
    }

    for (const effort of ["", "High", "very-high", "3", "high;printf", "h\nx"]) {
      expectParseError(startArgv("--effort", effort));
    }
  });

  test("TEST-6 [REQ-7] gives an explicit launcher precedence and treats an empty environment launcher as unset", () => {
    const sources = [
      { env: {}, expected: undefined },
      { env: { ORCHESTRATOR_LAUNCH: undefined }, expected: undefined },
      { env: { ORCHESTRATOR_LAUNCH: "" }, expected: undefined },
      { env: { LAUNCH: "wt", SHELL: "wt" }, expected: undefined },
      { env: { ORCHESTRATOR_LAUNCH: "wt" }, expected: "wt" },
    ];

    for (const { env, expected } of sources) {
      expect(parseArgs(startArgv(), env)).toEqual({
        ok: true,
        args: {
          mode: "start",
          name: "review",
          colour: "blue",
          prompt: "",
          noWait: false,
          dryRun: false,
          launch: expected,
        },
      });
    }

    for (const unusedEnvLaunch of ["wt", "wt; unsafe", ""]) {
      expect(parseArgs(startArgv("--launch", "./launch-session --quiet"), {
        ORCHESTRATOR_LAUNCH: unusedEnvLaunch,
      })).toEqual({
        ok: true,
        args: {
          mode: "start",
          name: "review",
          colour: "blue",
          prompt: "",
          noWait: false,
          dryRun: false,
          launch: "./launch-session --quiet",
        },
      });
    }
  });

  test("TEST-7 [REQ-8] accepts only the documented launcher grammar from the flag or environment", () => {
    const valid = [
      "wt",
      "./launch-session",
      "../tools/launch-session --quiet",
      "~/bin/launch-session --mode=quiet",
      "env MODE=quiet ./launch-session",
      join(parse(tmpdir()).root, "tools", "launch-session") + " --mode=quiet",
    ];

    for (const launch of valid) {
      for (const result of [
        parseArgs(startArgv("--launch", launch), {}),
        parseArgs(startArgv(), { ORCHESTRATOR_LAUNCH: launch }),
      ]) {
        expect(result).toEqual({
          ok: true,
          args: {
            mode: "start",
            name: "review",
            colour: "blue",
            prompt: "",
            noWait: false,
            dryRun: false,
            launch,
          },
        });
      }
    }

    for (const launch of invalidLaunchCommands()) {
      expectParseError(startArgv("--launch", launch));
      if (launch !== "") {
        expectParseError(startArgv(), { ORCHESTRATOR_LAUNCH: launch });
      }
    }
  });

  test("TEST-8 [REQ-5, REQ-9] returns delivery arguments only for the delivery flag set", () => {
    const lock = join(tmpdir(), "orchestrator-window-testdata", "delivery-lock");

    expect(parseArgs([
      "--deliver-to", "%7", "--prompt", "--literal-prompt", "--lock", lock,
    ], {})).toEqual({
      ok: true,
      args: { mode: "deliver", pane: "%7", prompt: "--literal-prompt", lock },
    });
    expect(parseArgs(["--prompt", "hello", "--deliver-to", "%7"], {})).toEqual({
      ok: true,
      args: { mode: "deliver", pane: "%7", prompt: "hello" },
    });

    const forbiddenExtras = [
      ["--name", "review"],
      ["--colour", "blue"],
      ["--color", "blue"],
      ["--dir", "checkout"],
      ["--session", "development"],
      ["--split", "%8"],
      ["--model", "model-2"],
      ["--effort", "high"],
      ["--launch", "wt"],
      ["--no-wait"],
      ["--dry-run"],
    ];

    for (const extra of forbiddenExtras) {
      expectParseError(["--deliver-to", "%7", "--prompt", "hello", ...extra]);
    }

    expectParseError(startArgv("--lock", lock));
    expectParseError(["--prompt", "hello", "--deliver-to"]);
    expectParseError(["--deliver-to", "%7", "--prompt"]);
    expectParseError(["--deliver-to", "%7", "--prompt", "hello", "--lock"]);
    expectParseError(["--deliver-to", "%7", "--prompt", "hello", "--deliver-to", "%8"]);
    expectParseError(["--deliver-to", "%7", "--prompt", "hello", "--prompt", "again"]);
    expectParseError(["--deliver-to", "%7", "--prompt", "hello", "--lock", lock, "--lock", lock]);
  });
});

describe("main checkout derivation", () => {
  test("TEST-9 [REQ-10] strips the absolute common .git suffix after whitespace and trailing slashes", () => {
    const checkout = join(tmpdir(), "orchestrator-window-testdata", "main checkout");
    const commonDir = join(checkout, ".git");
    const inputs = [commonDir, commonDir + "/", " \t" + commonDir + "///\n"];

    for (const input of inputs) {
      expect(mainCheckoutFromCommonDir(input)).toBe(checkout);
    }
  });

  test("TEST-10 [REQ-10] returns null for common directories that cannot name a main checkout", () => {
    const checkout = join(tmpdir(), "orchestrator-window-testdata", "checkout");
    const invalid = [
      "",
      " \n\t",
      ".git",
      "repo/.git",
      "../repo/.git",
      checkout,
      join(checkout, "bare.git"),
      join(checkout, ".git", "modules", "child"),
      join(checkout, ".git", "worktrees", "child"),
      join(checkout, ".git.backup"),
    ];

    for (const input of invalid) {
      expect(mainCheckoutFromCommonDir(input)).toBeNull();
    }
  });
});

describe("guarded launch lines", () => {
  test("TEST-11 [REQ-11, REQ-12] builds the guarded default Claude launch without model or effort defaults", () => {
    const name = "main.repo";
    const colour = "cyan";

    const line = buildLaunchLine({ name, colour });

    expectLaunchLine(
      line,
      defaultLaunchPrefix(name, colour) + "\\s+" + shellWord("/color cyan"),
    );
  });

  test("TEST-12 [REQ-12] includes only supplied model and effort flags before the default colour prompt", () => {
    const cases = [
      {
        options: { model: "Model_9.2-X" },
        expected: "\\s+--model\\s+" + shellWord("Model_9.2-X"),
      },
      {
        options: { effort: "high" },
        expected: "\\s+--effort\\s+" + shellWord("high"),
      },
      {
        options: { model: "model-2", effort: "medium" },
        expected: "\\s+--model\\s+" + shellWord("model-2") +
          "\\s+--effort\\s+" + shellWord("medium"),
      },
    ];

    for (const { options, expected } of cases) {
      const line = buildLaunchLine({ name: "review", colour: "pink", ...options });

      expectLaunchLine(
        line,
        defaultLaunchPrefix("review", "pink") + expected +
          "\\s+" + shellWord("/color pink"),
      );
    }
  });

  test("TEST-13 [REQ-11, REQ-13] forwards only supplied custom-launch options after name and colour", () => {
    const cases = [
      { launch: "wt", options: {}, expected: "" },
      {
        launch: "./launch-session",
        options: { model: "Model_9.2-X" },
        expected: "\\s+--\\s+--model\\s+" + shellWord("Model_9.2-X"),
      },
      {
        launch: "env MODE=quiet ./launch-session",
        options: { effort: "high" },
        expected: "\\s+--\\s+--effort\\s+" + shellWord("high"),
      },
      {
        launch: "wt",
        options: { model: "model-2", effort: "medium" },
        expected: "\\s+--\\s+--model\\s+" + shellWord("model-2") +
          "\\s+--effort\\s+" + shellWord("medium"),
      },
    ];

    for (const { launch, options, expected } of cases) {
      const line = buildLaunchLine({
        name: "launch-check", colour: "orange", launch, ...options,
      });
      const command = launch.split(" ").map(shellWord).join("\\s+");

      expectLaunchLine(
        line,
        command + "\\s+" + shellWord("launch-check") +
          "\\s+" + shellWord("orange") + expected,
      );
    }
  });

  test("TEST-14 [REQ-14] throws Error for invalid direct launch fields instead of emitting shell text", () => {
    const invalidFields = [
      { name: "" },
      { name: "a".repeat(49) },
      { name: "Review" },
      { name: "review;printf" },
      { colour: "mauve" },
      { colour: "blue;printf" },
      { model: "" },
      { model: "model/route" },
      { model: "model;printf" },
      { effort: "" },
      { effort: "High" },
      { effort: "very-high" },
      ...invalidLaunchCommands().map((launch) => ({ launch })),
    ];

    for (const invalid of invalidFields) {
      // Invalid runtime inputs intentionally cross the public TypeScript type.
      const spec = {
        name: "review", colour: "blue", ...invalid,
      } as Parameters<typeof buildLaunchLine>[0];

      expect(() => buildLaunchLine(spec)).toThrow(Error);
    }
  });
});

describe("checkout locks and state-directory paths", () => {
  test("TEST-15 [REQ-15] derives deterministic case-preserving lock keys from checkout paths", () => {
    const root = parse(tmpdir()).root;
    const state = join(tmpdir(), "orchestrator-window-testdata", "state");
    const cases = [
      {
        checkout: join(root, "Workspace.One", "Product _Repo", "api.v2"),
        key: "Workspace-One-Product-_Repo-api-v2",
      },
      {
        checkout: join(root, "Work__Space", "Product--Repo"),
        key: "Work__Space-Product--Repo",
      },
      { checkout: join(root, "---Team", "Repo...---"), key: "Team-Repo" },
      { checkout: root + "Team...//Product", key: "Team-Product" },
    ];

    for (const { checkout, key } of cases) {
      for (const suffix of ["", "/", "////"]) {
        expect(lockPathFor(state, checkout + suffix)).toBe(join(state, "locks", key));
      }
    }

    expect(lockPathFor(state, join(root, "Repo-A"))).not.toBe(
      lockPathFor(state, join(root, "Repo-B")),
    );
  });

  test("TEST-16 [REQ-16] throws Error for nonabsolute checkouts or an empty sanitised key", () => {
    const root = parse(tmpdir()).root;
    const state = join(tmpdir(), "orchestrator-window-testdata", "state");
    const invalid = ["", ".", "relative/repo", "../repo", root, join(root, "...---")];

    for (const checkout of invalid) {
      expect(() => lockPathFor(state, checkout)).toThrow(Error);
    }
  });

  test("TEST-17 [REQ-17, REQ-18] selects a nonempty state override or the supplied home fallback", () => {
    const home = join(tmpdir(), "orchestrator-window-testdata", "home");
    const override = join(tmpdir(), "orchestrator-window-testdata", "custom-state");
    const fallback = join(home, ".claude", "orchestrator");
    const fallbackEnvironments = [
      {},
      { ORCHESTRATOR_STATE_DIR: undefined },
      { ORCHESTRATOR_STATE_DIR: "" },
      { CLAUDE_PLUGIN_DATA: join(tmpdir(), "unrelated-plugin-data") },
    ];

    for (const env of fallbackEnvironments) {
      expect(stateDir(env, home)).toBe(fallback);
    }
    expect(stateDir({ ORCHESTRATOR_STATE_DIR: override + "///" }, home)).toBe(override);

    for (const unusedHome of ["", "relative-home"]) {
      expect(stateDir({ ORCHESTRATOR_STATE_DIR: override }, unusedHome)).toBe(override);
    }
  });

  test("TEST-18 [REQ-18] throws Error when the selected state path is not absolute", () => {
    const home = join(tmpdir(), "orchestrator-window-testdata", "home");

    for (const override of ["relative/state", "./state", "~/state"]) {
      expect(() => stateDir({ ORCHESTRATOR_STATE_DIR: override }, home)).toThrow(Error);
    }

    for (const invalidHome of ["", "relative-home", "./home"]) {
      expect(() => stateDir({}, invalidHome)).toThrow(Error);
      expect(() => stateDir({ ORCHESTRATOR_STATE_DIR: "" }, invalidHome)).toThrow(Error);
    }
  });
});

describe("pane foreground and unsubmitted-input predicates", () => {
  test("TEST-19 [REQ-19] accepts only a trimmed three-number Claude foreground version", () => {
    const valid = ["2.1.300", " \t10.42.0\n", "0.0.0", "02.001.300"];
    const invalid = [
      "", " \n", "zsh", "node", "claude", "2.1", "2.1.300.4",
      "v2.1.300", "2.1.300-beta", "x2.1.300", "2x1x300",
      "2.1.300 busy", "2.\n1.300",
    ];

    for (const command of valid) {
      expect(isClaudeForeground(command)).toBe(true);
    }
    for (const command of invalid) {
      expect(isClaudeForeground(command)).toBe(false);
    }
  });

  test("TEST-20 [REQ-20] finds the short prompt on the last input-marker line even above a footer", () => {
    const prompt = "Summarise changes";
    const screens = [
      "❯ " + prompt,
      [
        "❯ older request",
        "assistant output",
        " \t❯ prefix " + prompt + " suffix",
        "status ❯ ready",
        "footer",
      ].join("\n"),
    ];

    for (const screen of screens) {
      expect(promptStillInInput(screen, prompt)).toBe(true);
    }
  });

  test("TEST-21 [REQ-20] matches exactly the first 40 prompt characters rather than the full long prompt", () => {
    const prefix = "0123456789".repeat(4);
    const prompt = prefix + " original long-prompt suffix";

    expect(promptStillInInput("❯ " + prefix, prompt)).toBe(true);
    expect(promptStillInInput("❯ " + prefix + " different suffix", prompt)).toBe(true);
    expect(promptStillInInput("❯ " + prefix.slice(0, 39), prompt)).toBe(false);
    expect(promptStillInInput("❯ " + prefix.slice(0, 39) + "X", prompt)).toBe(false);
  });

  test("TEST-22 [REQ-20] rejects empty prompts, output matches and superseded input lines", () => {
    const prompt = "Summarise changes";
    const screens = [
      "",
      prompt,
      "output ❯ " + prompt,
      "› " + prompt,
      "❯ " + prompt + "\n  ❯ ",
      "❯ " + prompt + "\n\t❯ unrelated request",
      "❯ summarise changes",
      "assistant: " + prompt + "\n❯ ",
    ];

    for (const screen of screens) {
      expect(promptStillInInput(screen, prompt)).toBe(false);
    }
    expect(promptStillInInput("❯ ", "")).toBe(false);
    expect(promptStillInInput("❯ " + prompt, "")).toBe(false);
  });
});

describe("stale-lock decisions", () => {
  test("TEST-23 [REQ-21] expires well-formed lock info only beyond 16 minutes or for a dead holder", () => {
    const now = 4_000_000;
    const observations = [
      { pid: 17, since: now, now, stale: false },
      { pid: 17, since: now - 959_999, now, stale: false },
      { pid: 17, since: now - 960_000, now, stale: false },
      { pid: 17, since: now - 960_001, now, stale: true },
      { pid: 23, since: now, now, stale: true },
      { pid: 17, since: now + 1, now, stale: false },
      { pid: 17, since: 0, now: 100, stale: false },
      { pid: 17, since: -1, now: 0, stale: false },
    ];

    for (const row of observations) {
      const result = lockIsStale({
        infoText: JSON.stringify({ pid: row.pid, since: row.since }),
        lockMtimeMs: row.now - 1,
        now: row.now,
        pidAlive: (pid) => pid === 17,
      });

      expect(result).toBe(row.stale);
    }

    expect(lockIsStale({
      infoText: JSON.stringify({ pid: 17, since: now }),
      lockMtimeMs: now,
      now,
      pidAlive: () => { throw new Error("Process status unavailable"); },
    })).toBe(true);
  });

  test("TEST-24 [REQ-22] preserves fresh info-less locks but treats older or gone directories as stale", () => {
    const now = 9_000_000;
    const ages = [
      { age: 0, stale: false },
      { age: 4_999, stale: false },
      { age: 5_001, stale: true },
    ];

    for (const { age, stale } of ages) {
      expect(lockIsStale({
        infoText: null,
        lockMtimeMs: now - age,
        now,
        pidAlive: () => true,
      })).toBe(stale);
    }

    for (const infoText of [null, JSON.stringify({ pid: 17, since: now })]) {
      expect(lockIsStale({
        infoText,
        lockMtimeMs: null,
        now,
        pidAlive: () => true,
      })).toBe(true);
    }
  });

  test("TEST-25 [REQ-23] treats malformed lock info as stale even while the directory is fresh", () => {
    const malformed = [
      "",
      "{",
      "null",
      "[]",
      "42",
      "false",
      '"text"',
      "{}",
      '{"since":100}',
      '{"pid":17}',
      '{"pid":0,"since":100}',
      '{"pid":-1,"since":100}',
      '{"pid":1.5,"since":100}',
      '{"pid":"17","since":100}',
      '{"pid":true,"since":100}',
      '{"pid":1e400,"since":100}',
      '{"pid":17,"since":null}',
      '{"pid":17,"since":"100"}',
      '{"pid":17,"since":"not-a-number"}',
      '{"pid":17,"since":true}',
      '{"pid":17,"since":1e400}',
      '{"pid":17,"since":-1e400}',
    ];

    for (const infoText of malformed) {
      expect(lockIsStale({
        infoText,
        lockMtimeMs: 100,
        now: 100,
        pidAlive: () => true,
      })).toBe(true);
    }
  });
});
