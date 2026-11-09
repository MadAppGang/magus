import { describe, expect, test } from "bun:test";
import {
  shellSegments, ghSegment, commandWordIndex, isRuntimeCodeFlag,
  scanHeredocs, stripDataHeredocs, readsInputAsData, hasSubstitution,
  commandWords, isAssignment, basename, type ShellToken,
} from "./gh-argv";

const words = (...text: string[]): ShellToken[] => text.map(text => ({ text, expanded: false }));
function gh(command: string) {
  const segments = shellSegments(command);
  expect(segments).toHaveLength(1);
  const tokens = segments[0]!.tokens;
  expect(tokens[0]?.text).toBe("gh");
  return ghSegment(tokens.slice(1));
}

describe("shell words and gh argv [R3.3; §4.3]", () => {
  test("[REQ-15; §4.3] TEST-201 splits operators outside quotes, removes redirects and respects comments", () => {
    const parts = shellSegments("cd app && gh issue comment 7 -b 'one; two | three' >out 2>&1; gh issue view 8 # ignored\n gh issue list");
    expect(parts.map(s => s.tokens.map(t => t.text))).toEqual([
      ["cd", "app"], ["gh", "issue", "comment", "7", "-b", "one; two | three"],
      ["gh", "issue", "view", "8"], ["gh", "issue", "list"],
    ]);
    const tokens = shellSegments("gh issue comment 7 -b \"a \\\"quote\\\" and \\$literal\"")[0]!.tokens;
    expect(tokens.at(-1)).toEqual({ text: 'a "quote" and $literal', expanded: false });
    expect(shellSegments("gh issue comment 7 -b '$BODY'")[0]!.tokens.at(-1)).toEqual({ text: "$BODY", expanded: false });
    expect(shellSegments('gh issue comment 7 -b "$BODY"')[0]!.tokens.at(-1)).toEqual({ text: "$BODY", expanded: true });
  });

  for (const [short, long, group] of [
    ["-t", "--title", "issue"], ["-b", "--body", "issue"], ["-F", "--body-file", "issue"],
    ["-l", "--label", "issue"], ["-a", "--assignee", "issue"], ["-m", "--milestone", "issue"],
    ["-p", "--project", "issue"], ["-R", "--repo", "issue"], ["-X", "--method", "api"],
    ["-f", "--raw-field", "api"], ["-F", "--field", "api"], ["-H", "--header", "api"],
    ["-q", "--jq", "api"],
  ]) {
    test(`[REQ-15; §4.3] TEST-202 maps ${group} ${short} to ${long} and consumes its value`, () => {
      const endpoint = group === "api" ? "graphql" : "edit";
      const s = ghSegment(words(group!, endpoint, short!, "literal", "7"));
      expect(s.flags.get(long!)).toEqual(["literal"]);
      expect(s.refs).toEqual(["#7"]);
    });
  }

  test("[REQ-15; §4.3] TEST-203 lifts globals, keeps repeated values, and keeps all own and foreign refs", () => {
    const s = gh("gh -R example/product --hostname github.com issue edit --add-assignee alice --add-assignee=bob --future 7 '#7' other/repo#7 https://github.com/example/product/issues/7 --repo=example/final");
    expect({ group: s.group, verb: s.verb, repo: s.repo, refs: s.refs }).toEqual({
      group: "issue", verb: "edit", repo: "example/final",
      refs: ["#7", "#7", "other/repo#7", "https://github.com/example/product/issues/7"],
    });
    expect(s.flags.get("--add-assignee")).toEqual(["alice", "bob"]);
    expect(s.flags.get("--hostname")).toEqual(["github.com"]);
    expect(s.flags.has("--future")).toBe(true);
    expect(gh("gh api -XPOST graphql -f query=literal").flags.get("--method")).toEqual(["POST"]);
    expect(gh("gh issue list -if 7").flags.has("-if")).toBe(true);
    expect(gh('gh api graphql -f "query=$QUERY"').expanded.has("--raw-field")).toBe(true);
    expect(gh("gh api graphql -f 'query=$QUERY'").expanded.size).toBe(0);
  });

  for (const flag of [
    "--repo", "--hostname", "--title", "--body", "--body-file", "--label",
    "--add-label", "--remove-label", "--assignee", "--add-assignee", "--remove-assignee",
    "--milestone", "--project", "--add-project", "--remove-project", "--method",
    "--field", "--raw-field", "--input", "--header", "--jq", "--template", "--json",
    "--search", "--state", "--limit", "--reason", "--comment", "--duplicate-of",
  ]) {
    test(`[REQ-15; §4.3] TEST-203 consumes value flag ${flag} before a numeric ref`, () => {
      const s = ghSegment(words("issue", "edit", flag, "value", "--web", "7"));
      expect(s.flags.get(flag)).toEqual(["value"]);
      expect(s.refs).toEqual(["#7"]);
      expect(s.flags.has("--web")).toBe(true);
    });
  }
});

describe("command words and runtime code [R3.3; final review decisions]", () => {
  for (const command of [
    "bun --env-file=/dev/null --config=/dev/null ./scripts/ticket-window.ts --name review",
    "exec bun --no-env-file --config /dev/null ./scripts/ticket-window.ts",
    "env X=1 bun run ./scripts/ticket-window.ts",
    "/usr/bin/env X=1 command bun --env-file /dev/null ./scripts/ticket-window.ts",
    "X=1 command ./scripts/ticket-window.ts",
    "./ticket-window.ts",
  ]) {
    test(`[REQ-15; §4.3] TEST-204 finds the script command word through ${command}`, () => {
      const tokens = shellSegments(command)[0]!.tokens;
      expect(basename(tokens[commandWordIndex(tokens)]!.text)).toBe("ticket-window.ts");
    });
  }
  for (const command of ["bun test scripts/ticket-window.spec.ts", "bun x tool", "bun install"]) {
    test(`[REQ-15; §4.3] TEST-204 does not unwrap Bun subcommand ${command}`, () => {
      const tokens = shellSegments(command)[0]!.tokens;
      expect(tokens[commandWordIndex(tokens)]?.text).toBe("bun");
    });
  }
  for (const flag of [
    "-e", "-p", "-eCODE", "-pCODE", "--eval", "--eval=CODE", "--print", "--print=CODE",
    "--preload", "--preload=hook", "--require", "--require=hook", "-r", "-rhook",
    "--import", "--import=hook", "--loader", "--loader=hook",
  ]) {
    test(`[REQ-15; §4.3] TEST-204 keeps runtime code flag ${flag} at the command word`, () => {
      expect(isRuntimeCodeFlag(flag)).toBe(true);
      const tokens = words("bun", flag, "gh issue create", "./scripts/ticket-window.ts");
      expect(commandWordIndex(tokens)).toBe(0);
    });
  }
  test("[REQ-15; §4.3] TEST-204 literal assignments and command probes have no command word; env -S stays code", () => {
    expect(commandWordIndex(words("X=literal"))).toBe(-1);
    expect(commandWordIndex(words("command", "-v", "gh"))).toBe(-1);
    expect(commandWordIndex(words("env", "-S", "gh issue create"))).toBe(0);
    for (const flag of ["--env-file=/dev/null", "--config=/dev/null", "--no-env-file", "run"]) expect(isRuntimeCodeFlag(flag)).toBe(false);
    expect(isAssignment("X=value")).toBe(true);
    expect(isAssignment("9X=value")).toBe(false);
    expect(isAssignment("X")).toBe(false);
  });
});

describe("heredocs and trigger text [R3.3; final review decisions]", () => {
  for (const delimiter of ["'EOF'", '"EOF"', "\\EOF"]) {
    test(`[REQ-15; §4.3] TEST-205 removes literal data heredoc ${delimiter} without evaluating its content`, () => {
      const command = "cat > notes <<" + delimiter + "\n$(gh issue create)\n`gh issue create`\nEOF\nprintf done";
      const result = scanHeredocs(command);
      expect(result.substitutingBody).toBe(false);
      expect(result.text).not.toContain("issue create");
      expect(result.text).toContain("printf done");
      expect(stripDataHeredocs(command)).toBe(result.text);
    });
  }
  test("[REQ-15; §4.3] TEST-205 unquoted body substitutions and executable/unterminated bodies remain visible", () => {
    for (const substitution of ["$(gh issue create)", "`gh issue create`"]) {
      const scan = scanHeredocs("cat <<EOF\n" + substitution + "\nEOF");
      expect(scan.substitutingBody).toBe(true);
      expect(scan.text).toContain(substitution);
    }
    expect(scanHeredocs("cat <<EOF\nplain data\nEOF").text).not.toContain("plain data");
    expect(scanHeredocs("cat <<-EOF\n\t$(gh issue create)\n\tEOF").substitutingBody).toBe(true);
    for (const command of ["bash <<'EOF'\ngh issue create\nEOF", "cat <<'EOF' | bash\ngh issue create\nEOF", "unknown <<'EOF'\ngh issue create\nEOF", "cat <<'EOF'\ngh issue create"]) {
      expect(stripDataHeredocs(command)).toContain("gh issue create");
    }
    expect(readsInputAsData("cat > notes")).toBe(true);
    expect(readsInputAsData("bun scripts/orch-state.ts tasks")).toBe(true);
    for (const command of ["bash", "eval", "xargs", "unknown", "cat >(bash)"]) expect(readsInputAsData(command)).toBe(false);
  });
  for (const [command, expected] of [
    ["echo $(gh issue create)", true], ['echo "$(gh issue create)"', true],
    ["echo `gh issue create`", true], ["cat <(gh issue list)", true],
    ["cat >(bash)", true], ["echo '$(gh issue create)'", false],
    ["echo '\`gh issue create\`'", false], ['echo "<(gh issue list)"', false],
    ["echo \\$(literal)", false],
  ] as const) {
    test(`[REQ-15; §4.3] TEST-205 detects only executable substitutions in ${command}`, () => expect(hasSubstitution(command)).toBe(expected));
  }
  test("[REQ-15; §4.3] TEST-206 finds quoted and nested command words but does not invent variable-built words", () => {
    const found = commandWords('eval "g\'\'h issue create"; sh -c "gh label create"; bun ./scripts/ticket-window.ts');
    for (const word of ["gh", "issue", "label", "ticket-window.ts"]) {
      expect([...found].some(w => w === word || basename(w) === word)).toBe(true);
    }
    expect(commandWords("$a$b").has("gh")).toBe(false);
  });
});
