import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  parseArgs,
  mainCheckoutFromCommonDir,
  buildLaunchLine,
  buildLaunch,
  buildChildLine,
  parseHerdrPaneState,
  herdrFocusedWorkspace,
  buildHerdrTabCreate,
  parseHerdrTabCreate,
  herdrPaneOfTab,
  parseHerdrPane,
  buildHerdrRun,
  screenShowsTrustError,
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

  test("TEST-8 [REQ-5, REQ-9, REQ-26] returns delivery arguments only for the mux-qualified delivery flag set", () => {
    const lock = join(tmpdir(), "orchestrator-window-testdata", "delivery-lock");

    for (const mux of ["tmux", "herdr"] as const) {
      const pane = mux === "tmux" ? "%7" : "w5:p3";

      expect(parseArgs([
        "--deliver-to", pane, "--prompt", "--literal-prompt", "--lock", lock,
        "--mux", mux,
      ], {})).toEqual({
        ok: true,
        args: { mode: "deliver", pane, prompt: "--literal-prompt", lock, mux },
      });
      expect(parseArgs(["--mux", mux, "--prompt", "hello", "--deliver-to", pane], {})).toEqual({
        ok: true,
        args: { mode: "deliver", pane, prompt: "hello", mux },
      });
      expect(parseArgs(["--deliver-to", pane, "--mux", mux, "--prompt", ""], {})).toEqual({
        ok: true,
        args: { mode: "deliver", pane, prompt: "", mux },
      });

      const base = ["--deliver-to", pane, "--mux", mux, "--prompt", "hello"];
      const forbiddenExtras = [
        ["--name", "review"], ["--colour", "blue"], ["--color", "blue"],
        ["--dir", "checkout"], ["--session", "development"], ["--split", "%8"],
        ["--model", "model-2"], ["--effort", "high"], ["--launch", "wt"],
        ["--no-wait"], ["--dry-run"], ["--print-line"],
      ];

      for (const extra of forbiddenExtras) {
        expectParseError([...base, ...extra]);
      }
      expectParseError(["--mux", mux, "--prompt", "hello", "--deliver-to"]);
      expectParseError(["--deliver-to", pane, "--mux", mux, "--prompt"]);
      expectParseError([...base, "--lock"]);
      expectParseError([...base, "--deliver-to", "%8"]);
      expectParseError([...base, "--prompt", "again"]);
      expectParseError([...base, "--lock", lock, "--lock", lock]);
    }

    expectParseError(startArgv("--lock", lock));
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

describe("print-line and delivery argument changes", () => {
  test("TEST-26 [REQ-24] rejects the removed split flag with its specified diagnostic", () => {
    for (const argv of [["--split", "%7"], startArgv("--split", "%7")]) {
      expect(parseArgs(argv, {})).toEqual({
        ok: false, error: 'unknown flag "--split"',
      });
    }
  });

  test("TEST-27 [REQ-25] returns print-line defaults without start-only fields", () => {
    for (const flag of ["--colour", "--color"]) {
      expect(parseArgs(["--print-line", "--name", "review", flag, "blue"], {})).toEqual({
        ok: true,
        args: { mode: "print-line", name: "review", colour: "blue" },
      });
    }
  });

  test("TEST-28 [REQ-25, REQ-7] preserves print-line options and applies the same launch-source precedence", () => {
    const dir = join(tmpdir(), "orchestrator-window-testdata", "main checkout");
    const required = startArgv("--print-line", "--dir", dir, "--model", "Model_9.2-X", "--effort", "high");

    for (const source of ["flag", "env"] as const) {
      const argv = source === "flag" ? [...required, "--launch", "env MODE=quiet ./launch-session"] : required;
      const env = source === "env"
        ? { ORCHESTRATOR_LAUNCH: "env MODE=quiet ./launch-session" }
        : { ORCHESTRATOR_LAUNCH: "bad; unused" };

      expect(parseArgs(argv, env)).toEqual({
        ok: true,
        args: {
          mode: "print-line", name: "review", colour: "blue", dir,
          model: "Model_9.2-X", effort: "high", launch: "env MODE=quiet ./launch-session",
        },
      });
    }
    for (const env of [{}, { ORCHESTRATOR_LAUNCH: "" }]) {
      expect(parseArgs(startArgv("--print-line", "--dir", "--session"), env)).toEqual({
        ok: true,
        args: { mode: "print-line", name: "review", colour: "blue", dir: "--session" },
      });
    }
  });

  test("TEST-29 [REQ-25] rejects every print-line conflict regardless of flag order", () => {
    const conflicts = [
      ["--prompt", "hello"], ["--prompt", ""], ["--session", "development"],
      ["--no-wait"], ["--dry-run"], ["--deliver-to", "%7", "--mux", "tmux"],
    ];

    for (const conflict of conflicts) {
      expectParseError([...startArgv("--print-line"), ...conflict]);
      expectParseError([...conflict, ...startArgv("--print-line")]);
    }
  });

  test("TEST-30 [REQ-25, REQ-1, REQ-2, REQ-5, REQ-6, REQ-8] validates print-line values and rejects repeated or inapplicable flags", () => {
    for (const argv of [
      ["--print-line"], ["--print-line", "--name", "review"],
      ["--print-line", "--colour", "blue"], startArgv("--print-line", "--print-line"),
      startArgv("--print-line", "--name", "other"), startArgv("--print-line", "--color", "red"),
      startArgv("--print-line", "--lock", "unused"), startArgv("--print-line", "--mux", "tmux"),
      ["--print-line", "--name", "a".repeat(49), "--colour", "blue"],
      ["--print-line", "--name", "Review", "--colour", "blue"],
      ["--print-line", "--name", "review", "--colour", "Red"],
      startArgv("--print-line", "--dir", ""),
      startArgv("--print-line", "--model", "route/model"),
      startArgv("--print-line", "--effort", "High"),
      startArgv("--print-line", "--unexpected"),
    ]) {
      expectParseError(argv);
    }
    for (const [flag, value] of [
      ["--dir", "checkout"], ["--model", "model-2"], ["--effort", "high"], ["--launch", "wt"],
    ] as const) {
      expectParseError(startArgv("--print-line", flag));
      expectParseError(startArgv("--print-line", flag, value, flag, value));
    }
    for (const launch of invalidLaunchCommands()) {
      expectParseError(startArgv("--print-line", "--launch", launch));
      if (launch !== "") {
        expectParseError(startArgv("--print-line"), { ORCHESTRATOR_LAUNCH: launch });
      }
    }
  });

  test("TEST-31 [REQ-26, REQ-9, REQ-5] requires exactly one lower-case mux value only in delivery mode", () => {
    const deliver = ["--deliver-to", "%7", "--prompt", "hello"];

    expectParseError(deliver);
    expectParseError([...deliver, "--mux"]);
    for (const mux of ["", "TMUX", "HERDR", "screen", " tmux", "tmux ", "--no-wait"]) {
      expectParseError([...deliver, "--mux", mux]);
    }
    expectParseError([...deliver, "--mux", "tmux", "--mux", "tmux"]);
    expectParseError([...deliver, "--mux", "tmux", "--mux", "herdr"]);
    expectParseError(startArgv("--mux", "tmux"));
    expectParseError(["--mux", "herdr"]);
    expect(parseArgs(["--deliver-to", "--pane-literal", "--mux", "herdr", "--prompt", "--text", "--lock", "--lock-literal"], {})).toEqual({
      ok: true,
      args: { mode: "deliver", pane: "--pane-literal", mux: "herdr", prompt: "--text", lock: "--lock-literal" },
    });
  });

  test("TEST-32 [REQ-27] keeps diagnostics on one line and JSON-quotes any echoed input value", () => {
    const values = ["bad\nname", "bad\rname", "bad\tname", "bad\u0000name", 'bad"name', "bad\\name"];

    for (const value of values) {
      const invalidArguments = [
        ["--name", value, "--colour", "blue"],
        ["--name", "review", "--colour", value],
        startArgv("--model", value),
        startArgv("--effort", value),
        ["--unknown-" + value],
        [value],
      ];

      for (const argv of invalidArguments) {
        const result = parseArgs(argv, {});

        if (result.ok) {
          throw new Error("Expected invalid argument rejection: " + JSON.stringify(argv));
        }
        expect(result.error.trim()).not.toBe("");
        expect(result.error).not.toMatch(/[\u0000-\u001f]/);
        const echoedValue = argv[0] === "--unknown-" + value ? argv[0] : value;
        // An error need not echo the value, but an echoed value must be JSON-quoted.
        if (result.error.includes(echoedValue) || result.error.includes(JSON.stringify(echoedValue).slice(1, -1))) {
          expect(result.error).toContain(JSON.stringify(echoedValue));
        }
      }
    }
    expectParseError(["--unknown\nflag"]);
    expectParseError(["unexpected\nargument"]);
  });

  test("TEST-33 [REQ-27, REQ-44] parses frozen arguments using only the supplied relevant environment", () => {
    const environments = [
      Object.freeze({ ORCHESTRATOR_LAUNCH: undefined }),
      Object.freeze({ TMUX: "irrelevant", HERDR_ENV: "1", ORCHESTRATOR_MULTIPLEXER: "invalid" }),
    ];
    const argvs = [
      Object.freeze(startArgv()),
      Object.freeze(startArgv("--print-line")),
      Object.freeze(["--deliver-to", "%7", "--prompt", "hello", "--mux", "tmux"]),
    ];

    for (const argv of argvs) {
      const before = [...argv];
      const baseline = parseArgs(argv, {});

      expect(baseline.ok).toBe(true);
      for (const env of environments) {
        expect(parseArgs(argv, env)).toEqual(baseline);
      }
      expect(argv).toEqual(before);
    }
  });
});

// Session and new-window choices have separate contracts in mux-choice.spec.ts.

describe("standalone and child launch lines", () => {
  test("TEST-40 [REQ-30, REQ-12] builds only the default launch and includes exactly the flags supplied", () => {
    for (const name of ["a", "0", "a".repeat(48), "repo.2_name-branch"]) {
      for (const colour of ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan", "default"] as const) {
        expect(buildLaunch(Object.freeze({ name, colour }))).toMatch(new RegExp(
          "^" + defaultLaunchPrefix(name, colour) + "\\s+" + shellWord("/color " + colour) + "\\s*$",
        ));
      }
    }
    const cases = [
      { options: {}, expected: "" },
      { options: { model: "Model_9.2-X" }, expected: "\\s+--model\\s+" + shellWord("Model_9.2-X") },
      { options: { effort: "unlisted" }, expected: "\\s+--effort\\s+" + shellWord("unlisted") },
      {
        options: { model: "model-2", effort: "high" },
        expected: "\\s+--model\\s+" + shellWord("model-2") + "\\s+--effort\\s+" + shellWord("high"),
      },
    ];

    for (const { options, expected } of cases) {
      const spec = { name: "review", colour: "cyan" as const, ...options };
      const launch = buildLaunch(spec);

      expect(launch).toMatch(new RegExp("^" + defaultLaunchPrefix("review", "cyan") +
        expected + "\\s+" + shellWord("/color cyan") + "\\s*$"));
      expectLaunchLine(buildLaunchLine(spec), defaultLaunchPrefix("review", "cyan") +
        expected + "\\s+" + shellWord("/color cyan"));
      expect(buildLaunchLine(spec).endsWith(" && " + launch)).toBe(true);
    }
  });

  test("TEST-41 [REQ-30, REQ-13] builds only the custom launch with an option separator only when needed", () => {
    const cases = [
      { launch: "wt", options: {}, expected: "" },
      { launch: "./launch-session", options: { model: "Model_9.2-X" }, expected: "\\s+--\\s+--model\\s+" + shellWord("Model_9.2-X") },
      { launch: "env MODE=quiet ./launch-session", options: { effort: "high" }, expected: "\\s+--\\s+--effort\\s+" + shellWord("high") },
      {
        launch: "wt", options: { model: "model-2", effort: "high" },
        expected: "\\s+--\\s+--model\\s+" + shellWord("model-2") + "\\s+--effort\\s+" + shellWord("high"),
      },
    ];

    for (const { launch, options, expected } of cases) {
      const spec = { name: "review", colour: "blue" as const, launch, ...options };
      const command = buildLaunch(spec);
      const expectedCommand = launch.split(" ").map(shellWord).join("\\s+") +
        "\\s+" + shellWord("review") + "\\s+" + shellWord("blue") + expected;

      expect(command).toMatch(new RegExp("^" + expectedCommand + "\\s*$"));
      expectLaunchLine(buildLaunchLine(spec), expectedCommand);
      expect(buildLaunchLine(spec).endsWith(" && " + command)).toBe(true);
    }
  });

  test("TEST-42 [REQ-30, REQ-14, REQ-31] rejects the same unsafe launch fields in standalone, window and child lines", () => {
    const invalidFields = [
      { name: "" }, { name: "a".repeat(49) }, { name: ".repo" }, { name: "_repo" },
      { name: "Review" }, { name: "repo/path" }, { name: "repo\nnext" }, { name: "repo;run" },
      { colour: "" }, { colour: "Blue" }, { colour: "blue;run" }, { colour: "magenta" },
      { model: "" }, { model: ".model" }, { model: "model/route" }, { model: "model;run" },
      { effort: "" }, { effort: "High" }, { effort: "very-high" }, { effort: "h\nx" },
      ...invalidLaunchCommands().map((launch) => ({ launch })),
    ];
    const dir = join(tmpdir(), "orchestrator-window-testdata", "child checkout");

    for (const invalid of invalidFields) {
      const spec = { name: "review", colour: "blue", ...invalid } as Parameters<typeof buildLaunch>[0];

      expect(() => buildLaunch(spec)).toThrow(Error);
      expect(() => buildLaunchLine(spec)).toThrow(Error);
      expect(() => buildChildLine({ ...spec, dir })).toThrow(Error);
    }
  });

  test("TEST-43 [REQ-31] prepends only cd and git pull to default and custom child launches", () => {
    const dir = join(tmpdir(), "orchestrator-window-testdata", "child checkout");
    const specs = [
      { name: "child", colour: "green" as const },
      { name: "child", colour: "blue" as const, model: "Model_9.2-X", effort: "high" },
      { name: "child", colour: "red" as const, launch: "env MODE=quiet ./launch-session", effort: "medium" },
    ];

    for (const spec of specs) {
      const line = buildChildLine({ ...spec, dir });

      expect(line).toBe("cd '" + dir + "' && git pull --ff-only && " + buildLaunch(spec));
      expect(line).not.toContain("magus");
    }
  });

  test("TEST-44 [REQ-31] single-quotes the whole child directory and escapes every apostrophe", () => {
    const root = parse(tmpdir()).root;
    const cases = [
      { suffix: "O'Brien", quoted: "O'\\''Brien" },
      { suffix: "a'b'c", quoted: "a'\\''b'\\''c" },
      { suffix: "repo with spaces;$(touch nope)&x", quoted: "repo with spaces;$(touch nope)&x" },
      { suffix: "repo\\path", quoted: "repo\\path" },
    ];
    const spec = { name: "child", colour: "green" as const, launch: "wt" };

    for (const { suffix, quoted } of cases) {
      expect(buildChildLine({ ...spec, dir: root + suffix })).toBe(
        "cd '" + root + quoted + "' && git pull --ff-only && " + buildLaunch(spec),
      );
    }
  });

  test("TEST-45 [REQ-31] throws for relative, newline-containing or NUL-containing child directories", () => {
    const root = parse(tmpdir()).root;
    const invalid = ["", ".", "repo", "../repo", "~/repo", root + "repo\nnext", root + "repo\u0000next"];

    for (const dir of invalid) {
      expect(() => buildChildLine({ name: "child", colour: "green", dir })).toThrow(Error);
    }
  });
});

describe("herdr argv and response contracts", () => {
  test("TEST-46 [REQ-32] creates an explicitly scoped tab without focusing it and preserves argv values", () => {
    const dir = join(tmpdir(), "orchestrator-window-testdata", "O'Brien repo");
    const specs = [
      { dir, name: "review", workspace: "w5" },
      { dir, name: "a", workspace: "w5" },
      { dir, name: "0", workspace: "w5" },
      { dir, name: "a".repeat(48), workspace: "workspace with spaces" },
      { dir: parse(tmpdir()).root, name: "repo.v2_name-7", workspace: "--literal-workspace" },
    ];

    for (const spec of specs) {
      expect(buildHerdrTabCreate(Object.freeze(spec))).toEqual([
        "herdr", "tab", "create", "--workspace", spec.workspace,
        "--cwd", spec.dir, "--label", spec.name, "--no-focus",
      ]);
    }
  });

  test("TEST-47 [REQ-32] rejects an empty workspace, nonabsolute directory or invalid tab name", () => {
    const dir = join(tmpdir(), "orchestrator-window-testdata", "checkout");
    const base = { dir, name: "review", workspace: "w5" };
    const invalid = [
      { workspace: "" }, { dir: "" }, { dir: "relative" }, { dir: "~/repo" },
      { name: "" }, { name: "a".repeat(49) }, { name: "Review" }, { name: ".repo" },
      { name: "_repo" }, { name: "-repo" }, { name: "repo/path" }, { name: "repo;run" },
      { name: "repo name" }, { name: "repo\nnext" },
    ];

    for (const change of invalid) {
      expect(() => buildHerdrTabCreate({ ...base, ...change })).toThrow(Error);
    }
  });

  test("TEST-48 [REQ-33] reads tab and root-pane ids from the captured herdr response", () => {
    const stdout = readFileSync(new URL("./testdata/herdr-tab-create.json", import.meta.url), "utf8");

    expect(parseHerdrTabCreate(stdout)).toEqual({ tabId: "w5:t2", paneId: "w5:p3" });
  });

  test("TEST-49 [REQ-33] reads only root_pane.pane_id and never the superseded pane or tab fallbacks", () => {
    const cases = [
      { result: { tab: { tab_id: "w5:t2" } } },
      { result: { tab: { tab_id: "w5:t2", root_pane_id: "wrong" }, pane: { pane_id: "wrong" } } },
      { result: { tab: { tab_id: "w5:t2" }, root_pane: null } },
      { result: { tab: { tab_id: "w5:t2" }, root_pane: {} } },
      { result: { tab: { tab_id: "w5:t2" }, root_pane: { pane_id: 3 } } },
    ];

    for (const answer of cases) {
      expect(parseHerdrTabCreate(JSON.stringify(answer))).toEqual({ tabId: "w5:t2", paneId: null });
    }
    expect(parseHerdrTabCreate(JSON.stringify({
      result: { tab: { tab_id: "w5:t2", root_pane_id: "wrong" }, pane: { pane_id: "wrong" }, root_pane: { pane_id: "right" } },
    }))).toEqual({ tabId: "w5:t2", paneId: "right" });
    expect(parseHerdrTabCreate('{"result":{"tab":{"tab_id":""},"root_pane":{"pane_id":""}}}')).toEqual({
      tabId: "", paneId: "",
    });
  });

  test("TEST-50 [REQ-33] returns null without throwing for non-JSON and responses without a string tab id", () => {
    const invalid = [
      "", "not JSON", "{", "null", "[]", "42", "true", '"text"', "{}",
      '{"tab":{"tab_id":"wrong"}}', '{"result":null}', '{"result":[]}',
      '{"result":{"tab":null}}', '{"result":{"tab":{}}}',
      '{"result":{"tab":{"id":"w5:t2"}}}',
      ...[null, 2, false, [], {}].map((tab_id) => JSON.stringify({
        result: { tab: { tab_id }, root_pane: { pane_id: "w5:p3" } },
      })),
    ];

    for (const stdout of invalid) {
      expect(parseHerdrTabCreate(stdout)).toBeNull();
    }
  });

  test("TEST-51 [REQ-34] selects the first exact tab match from a pane list rather than the first pane", () => {
    const stdout = JSON.stringify({
      result: { panes: [
        { pane_id: "other", tab_id: "w5:t20" },
        { pane_id: "first", tab_id: "w5:t2" },
        { pane_id: "second", tab_id: "w5:t2" },
      ] },
    });

    expect(herdrPaneOfTab(stdout, "w5:t2")).toBe("first");
    expect(herdrPaneOfTab(stdout, "w5:t20")).toBe("other");
    expect(herdrPaneOfTab(stdout, "W5:T2")).toBeNull();
    expect(herdrPaneOfTab(stdout, "missing")).toBeNull();
    expect(herdrPaneOfTab('{"result":{"panes":[]}}', "w5:t2")).toBeNull();
  });

  test("TEST-52 [REQ-34] returns null without throwing for malformed pane-list envelopes and entries", () => {
    const invalid = [
      "", "not JSON", "{", "null", "[]", "42", "false", '"text"', "{}",
      '{"panes":[{"pane_id":"wrong","tab_id":"w5:t2"}]}', '{"result":null}',
      '{"result":{}}', '{"result":{"panes":null}}', '{"result":{"panes":{}}}',
      '{"result":{"panes":"not an array"}}',
      ...[null, 3, "text", {}, { tab_id: "w5:t2" }, { pane_id: "p", tab_id: 2 },
        { pane_id: 3, tab_id: "w5:t2" }].map((entry) => JSON.stringify({ result: { panes: [entry] } })),
    ];

    for (const stdout of invalid) {
      expect(herdrPaneOfTab(stdout, "w5:t2")).toBeNull();
    }
  });

  test("TEST-53 [REQ-35] maps one pane and fills absent or non-string optional fields with null", () => {
    const pane = { pane_id: "w5:p3", tab_id: "w5:t2", workspace_id: "w5", cwd: join(tmpdir(), "repo with spaces") };

    expect(parseHerdrPane(JSON.stringify({ result: { pane } }))).toEqual({
      paneId: pane.pane_id, tabId: pane.tab_id, workspaceId: pane.workspace_id, cwd: pane.cwd,
    });
    expect(parseHerdrPane('{"result":{"pane":{"pane_id":"w5:p3"}}}')).toEqual({
      paneId: "w5:p3", tabId: null, workspaceId: null, cwd: null,
    });
    for (const value of [null, 3, false, [], {}]) {
      expect(parseHerdrPane(JSON.stringify({
        result: { pane: { pane_id: "w5:p3", tab_id: value, workspace_id: value, cwd: value } },
      }))).toEqual({ paneId: "w5:p3", tabId: null, workspaceId: null, cwd: null });
    }
    expect(parseHerdrPane('{"result":{"pane":{"pane_id":"","tab_id":"","workspace_id":"","cwd":""}}}')).toEqual({
      paneId: "", tabId: "", workspaceId: "", cwd: "",
    });
  });

  test("TEST-54 [REQ-35] returns null without throwing when a pane response lacks a string pane id", () => {
    const invalid = [
      "", "not JSON", "{", "null", "[]", "42", "true", '"text"', "{}",
      '{"pane":{"pane_id":"wrong"}}', '{"result":null}', '{"result":{}}',
      '{"result":{"root_pane":{"pane_id":"wrong"}}}', '{"result":{"pane":null}}',
      '{"result":{"pane":{}}}',
      ...[null, 3, false, [], {}].map((pane_id) => JSON.stringify({ result: { pane: { pane_id } } })),
    ];

    for (const stdout of invalid) {
      expect(parseHerdrPane(stdout)).toBeNull();
    }
  });

  test("TEST-55 [REQ-36] builds pane run argv without shell-quoting or splitting the launch line", () => {
    const lines = ["", "git pull --ff-only && claude -w review", "cd 'O'\\''Brien repo' && printf '%s' \"$VALUE\""];

    for (const line of lines) {
      expect(buildHerdrRun("w5:p3", line)).toEqual(["herdr", "pane", "run", "w5:p3", line]);
    }
  });

  test("TEST-56 [REQ-36] rejects an empty pane or a newline anywhere in a run line", () => {
    expect(() => buildHerdrRun("", "true")).toThrow(Error);
    for (const line of ["\n", "\ntrue", "true\n", "first\nsecond", "first\r\nsecond"]) {
      expect(() => buildHerdrRun("w5:p3", line)).toThrow(Error);
    }
  });
});

describe("witnessed delivery arguments and launch-scoped trust", () => {
  test("[REQ-425] TEST-2722 --expect-terminal is herdr-delivery-only and preserves the witness literally", () => {
    expect(parseArgs(["--deliver-to", "w1:pA", "--mux", "herdr", "--trust-after", "l-launch", "--expect-terminal", "term_A", "--prompt", "hello"], {})).toEqual({
      ok: true, args: { mode: "deliver", pane: "w1:pA", mux: "herdr", prompt: "hello", trustAfter: "l-launch", expectTerminal: "term_A" },
    });
    for (const args of [
      ["--deliver-to", "w1:pA", "--mux", "tmux", "--expect-terminal", "term_A"],
      ["--deliver-to", "w1:pA", "--mux", "herdr", "--expect-terminal", ""],
      startArgv("--expect-terminal", "term_A"),
      startArgv("--trust-after", "l-launch"),
    ]) expectParseError(args);
  });
  test("[REQ-425] TEST-2722 parses the captured terminal, agent and status, refusing absent panes", () => {
    expect(parseHerdrPaneState(readFileSync(join(import.meta.dir, "testdata", "herdr-pane-get.json"), "utf8"))).toEqual({
      terminal: "term_65fe052984f745", agent: "claude", status: "idle",
    });
    for (const text of ["{", "", "null", "{}", '{"error":{"code":"pane_not_found"}}']) expect(parseHerdrPaneState(text)).toBeNull();
    expect(parseHerdrPaneState('{"result":{"pane":{}}}')).toEqual({ terminal: null, agent: null, status: null });
    const raw = readFileSync(join(import.meta.dir, "testdata", "herdr-workspace-list.json"), "utf8");
    const expected = JSON.parse(raw).result.workspaces.find((w: { focused: boolean }) => w.focused)?.workspace_id ?? null;
    expect(herdrFocusedWorkspace(raw)).toBe(expected);
    expect(herdrFocusedWorkspace("{")).toBeNull();
  });
  test("[REQ-422, REQ-427] TEST-2721 a stale refusal before the latest launch never blocks trust recovery", () => {
    const error = "Workspace trust not yet accepted", claim = "l-launch";
    expect(screenShowsTrustError(error + "\n" + claim, claim)).toBe(false);
    expect(screenShowsTrustError(claim + "\n" + error, claim)).toBe(true);
    expect(screenShowsTrustError(error, claim)).toBe(true);
    expect(screenShowsTrustError(error + "\n" + claim + "\n" + error, claim)).toBe(true);
    expect(screenShowsTrustError(claim + "\n" + error + "\n" + claim, claim)).toBe(false);
  });
});

describe("workspace trust-error recognition", () => {
  test("TEST-57 [REQ-37] finds the exact case-sensitive phrase anywhere on any screen line", () => {
    const phrase = "Workspace trust not yet accepted";
    const screens = [
      phrase, "Error creating worktree: " + phrase + ".",
      "header\n" + phrase + "\nfooter", "prefix" + phrase + "suffix",
      "  " + phrase + "\r\n",
    ];

    for (const screen of screens) {
      expect(screenShowsTrustError(screen)).toBe(true);
    }
  });

  test("TEST-58 [REQ-37] rejects empty screens, case variants and incomplete or split phrases", () => {
    const screens = [
      "", "Workspace trust accepted", "workspace trust not yet accepted",
      "Workspace Trust not yet accepted", "Workspace trust not yet Accepted",
      "Workspace trust not yet", "Workspace  trust not yet accepted",
      "Workspace trust not\nyet accepted", "Yes, I trust this folder",
    ];

    for (const screen of screens) {
      expect(screenShowsTrustError(screen)).toBe(false);
    }
  });
});

describe("lock-observation callback boundaries", () => {
  test("TEST-59 [REQ-21, REQ-22, REQ-23] never consults a pid for absent, malformed or gone locks", () => {
    const now = 9_000_000;
    const cases = [
      { infoText: null, lockMtimeMs: now, stale: false },
      { infoText: null, lockMtimeMs: now - 5_001, stale: true },
      { infoText: "{", lockMtimeMs: now, stale: true },
      { infoText: '{"pid":0,"since":1}', lockMtimeMs: now, stale: true },
      { infoText: '{"pid":17,"since":"1"}', lockMtimeMs: now, stale: true },
      { infoText: '{"pid":17,"since":9000000}', lockMtimeMs: null, stale: true },
      { infoText: null, lockMtimeMs: null, stale: true },
    ];

    for (const { infoText, lockMtimeMs, stale } of cases) {
      let calls = 0;

      const result = lockIsStale({
        infoText, lockMtimeMs, now,
        pidAlive: () => { calls++; return true; },
      });

      expect(result).toBe(stale);
      expect(calls).toBe(0);
    }
  });

  test("TEST-60 [REQ-21] uses the positive pid from well-formed info when deciding whether a fresh holder is alive", () => {
    const observation = { infoText: '{"pid":73,"since":100}', lockMtimeMs: 100, now: 101 };

    expect(lockIsStale({ ...observation, pidAlive: (pid) => pid === 73 })).toBe(false);
    expect(lockIsStale({ ...observation, pidAlive: (pid) => pid !== 73 })).toBe(true);
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
