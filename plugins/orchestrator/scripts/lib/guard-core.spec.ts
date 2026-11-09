import { describe, expect, test } from "bun:test";
import {
  decide, ownTicketOf, isOwn, mcpToolParts, isTrackerTool, isTrackerRead,
  type GuardInput, type OwnTicket, type GuardDecision,
} from "./guard-core";

const github: OwnTicket = Object.freeze({ tracker: "github", repo: "example/product", number: 7, label: "example/product#7" });
const keyed: OwnTicket = Object.freeze({ tracker: "key", key: "DEMO-7", label: "DEMO-7" });
const launcher = "./scripts/ticket-window.ts";
const flags = "--name review --colour blue";
const bash = (command: string, role: GuardInput["role"] = "manager", own: OwnTicket | null = github) =>
  decide({ role, own, toolName: "Bash", toolInput: { command } });
const mcp = (toolName: string, toolInput: unknown, role: GuardInput["role"] = "manager", own: OwnTicket | null = keyed) =>
  decide({ role, own, toolName, toolInput });
function allow(d: GuardDecision) { expect(d).toEqual({ kind: "allow" }); }
function deny(d: GuardDecision, why: RegExp = /triage|manager/i) {
  expect(d.kind).toBe("deny");
  if (d.kind !== "deny") throw new Error("Expected a guard refusal");
  expect(d.reason).toMatch(why);
  expect(d.reason.trim().length).toBeGreaterThan(0);
  return d.reason;
}

describe("qualified ticket identity [R3.3; §4.3]", () => {
  test("[REQ-13, REQ-15, REQ-16] TEST-301 derives own tickets without IO and rejects unsupported identifiers", () => {
    expect(ownTicketOf({ id: "Example/Product#7", url: null })).toEqual({ ...github, label: expect.any(String) });
    expect(ownTicketOf({ id: "#7", url: "https://github.com/Example/Product/issues/7" })).toEqual({ ...github, label: expect.any(String) });
    expect(ownTicketOf({ id: "#7", url: "https://github.com/example/product/issues/8" })).toEqual({ tracker: "github", repo: null, number: 7, label: expect.any(String) });
    expect(ownTicketOf({ id: "demo-7", url: null })).toMatchObject({ tracker: "key", key: "DEMO-7" });
    expect(ownTicketOf(null)).toBeNull();
    expect(ownTicketOf({ id: "not a ref", url: null })).toBeNull();
    expect(isOwn(github, { tracker: "github", repo: "EXAMPLE/PRODUCT", number: 7 })).toBe(true);
    expect(isOwn(keyed, { tracker: "key", key: "demo-7" })).toBe(true);
    for (const target of [
      { tracker: "github" as const, repo: "other/product", number: 7 },
      { tracker: "github" as const, repo: "example/product", number: 8 },
      { tracker: "github" as const, repo: null, number: 7 },
      { tracker: "key" as const, key: "DEMO-8" }, { tracker: "uuid" as const }, { tracker: "unknown" as const },
    ]) {
      expect(isOwn(github, target)).toBe(false);
      expect(isOwn(null, target)).toBe(false);
    }
    expect(isOwn({ ...github, repo: null }, { tracker: "github", repo: "example/product", number: 7 })).toBe(false);
  });
});

describe("roles and launcher modes [R3.1, R3.3, R3.4; final decisions]", () => {
  for (const role of [null, "triage"] as const) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-302 ${role ?? "plain"} allows launches, tracker writes and unfamiliar inputs`, () => {
      allow(bash("gh issue create --title x", role));
      allow(mcp("mcp__linear_server__save_issue", { title: "x" }, role));
      allow(decide({ role, own: null, toolName: "Skill", toolInput: { skill: "orchestrator:start-ticket" } }));
    });
  }
  for (const role of ["manager", "child"] as const) {
    for (const toolName of ["Skill", "SlashCommand"]) {
      for (const field of ["skill", "command"]) {
        for (const name of ["orchestrator:start-ticket", "/orchestrator:start-ticket", "/orchestrator:start-ticket #8"]) {
          test(`[REQ-13, REQ-15, REQ-16] TEST-302 refuses ${role} ${toolName} ${field}=${name} but not another skill`, () => {
            deny(decide({ role, own: github, toolName, toolInput: { [field]: name } }), /triage/);
            allow(decide({ role, own: github, toolName, toolInput: { [field]: "orchestrator:manager" } }));
            allow(decide({ role, own: github, toolName, toolInput: { [field]: "orchestrator:start-ticket-help" } }));
          });
        }
      }
    }
  }

  for (const command of [
    `bun ${launcher}`, `bun --env-file=/dev/null --config=/dev/null "${launcher}"`,
    "./another-directory/ticket-window.ts", "./ticket-window.ts",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-303 only a manager may inspect a valid child launch via ${command}`, () => {
      deny(bash(command + " " + flags), /triage/);
      allow(bash(command + " " + flags + " --print-line"));
      allow(bash(command + " " + flags + " --dry-run"));
      for (const suffix of ["", " --print-line", " --dry-run"]) deny(bash(command + " " + flags + suffix, "child"), /manager/);
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-303 refuses an exec-wrapped launcher even with child-inspection flags", () => {
    const command = `exec bun --env-file=/dev/null --config=/dev/null "${launcher}" ${flags}`;
    for (const role of ["manager", "child"] as const) {
      for (const suffix of ["", " --print-line", " --dry-run"]) deny(bash(command + suffix, role));
    }
  });
  for (const args of [
    "--split manager-pane " + flags,
    flags + " --prompt --print-line",
    flags + " --prompt --dry-run",
    flags + " --print-line --prompt x",
    flags + " --print-line --session other",
    flags + " --print-line --no-wait",
    flags + " --print-line --dry-run",
    "--name --print-line --colour blue",
    flags + " --print-line --dir",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-303 refuses invalid mode or flag-as-value ${args}`, () => {
      deny(bash(`bun ${launcher} ${args}`));
      allow(bash(`bun ${launcher} ${flags} --print-line`));
    });
  }
  for (const runtimeFlags of ["--env-file /dev/null --config /dev/null", "--no-env-file", "run", "--env-file=/dev/null --config=/dev/null"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-303 accepts all four documented runtime forms ${runtimeFlags}`, () => {
      allow(bash(`bun ${runtimeFlags} ${launcher} ${flags} --print-line`));
      deny(bash(`bun ${runtimeFlags} ${launcher} ${flags}`));
    });
  }
  for (const incomplete of ["--env-file", "--config"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-303 rejects a missing runtime value ${incomplete}`, () => {
      deny(bash(`bun ${launcher} ${flags} --print-line ${incomplete}`));
      allow(bash(`bun ${incomplete} /dev/null ${launcher} ${flags} --print-line`));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-303 env wrapping is no longer a permitted launcher form; mere paths do not execute", () => {
    deny(bash(`env X=1 bun run ${launcher} ${flags} --print-line`));
    deny(bash(`env X=1 bun run ${launcher} ${flags} --print-line`, "child"));
    allow(bash("bun test ./scripts/ticket-window.spec.ts"));
    allow(bash("grep foo ticket-window.ts"));
  });
});

describe("gh explicit allow-list [R3.1, R3.3; final decisions]", () => {
  for (const command of [
    "gh issue view 7", "gh issue list", "gh issue status",
    "gh label list", "gh label view bug", "gh project list", "gh project view 2",
    "gh project field-list 2", "gh project item-list 2",
    "gh pr comment 7 --body progress", "gh pr review 7 --approve",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-304 permits plain read or PR form ${command} for both roles`, () => {
      for (const role of ["manager", "child"] as const) allow(bash(command, role));
    });
  }
  for (const command of [
    "gh issue create", "gh issue delete 7", "gh issue transfer 7 other/product",
    "gh issue lock 7", "gh issue unlock 7", "gh issue pin 7", "gh issue unpin 7",
    "gh issue develop 7", "gh issue new", "gh issue extension-write",
    "gh label create bug", "gh label edit bug", "gh label delete bug",
    "gh project create", "gh project edit 2", "gh project item-add 2", "gh project delete 2",
    "gh alias set ic 'issue create'", "gh alias set --shell ic 'gh issue create'",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-304 denies write, alias or unknown tracker form ${command} with a read near-miss`, () => {
      for (const role of ["manager", "child"] as const) {
        deny(bash(command, role));
        allow(bash("gh issue view 7", role));
      }
    });
  }
  for (const verb of ["comment", "close", "reopen", "edit"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-305 ${verb} requires every ref plus explicit own repo and no GH_REPO anywhere`, () => {
      const tail = verb === "comment" ? " --body progress" : verb === "edit" ? " --add-assignee alice" : "";
      const own = `gh issue ${verb} 7 -R example/product${tail}`;
      allow(bash(own));
      allow(bash(`gh -R EXAMPLE/PRODUCT issue ${verb} '#7'${tail}`));
      for (const command of [
        `gh issue ${verb} 7${tail}`,
        `gh issue ${verb} 7 -R other/product${tail}`,
        `gh issue ${verb} -R example/product${tail}`,
        `gh issue ${verb} 7 8 -R example/product${tail}`,
        `gh issue ${verb} other/product#7 -R example/product${tail}`,
        `gh issue ${verb} https://github.com/other/product/issues/7 -R example/product${tail}`,
        `gh issue ${verb} nonsense -R example/product${tail}`,
        "GH_REPO=other/product " + own, "export GH_REPO=other/product; " + own,
        "env GH_REPO=other/product " + own, own + "; export GH_REPO=other/product",
      ]) deny(bash(command));
      deny(bash(own, "child"), /manager/);
      expect(deny(bash(`gh issue ${verb} 7${tail}`))).toMatch(/-R/);
      deny(bash(own, "manager", { ...github, repo: null }));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-305 accepts several refs only if all are own", () => {
    allow(bash("gh issue close 7 '#7' example/product#7 https://github.com/example/product/issues/7 -R example/product"));
    deny(bash("gh issue close 7 8 -R example/product"));
    allow(bash("cd ../app && gh issue view 7 | head"));
    deny(bash("cd ../app && gh issue close 7"));
  });
  for (const flag of [
    "--title x", "-t x", "--body x", "-b x", "--body-file notes", "-F notes",
    "--label bug", "-l bug", "--add-label bug", "--remove-label bug",
    "--milestone next", "-m next", "--project next", "-p next",
    "--add-project next", "--remove-project next", "--assignee alice", "-a alice",
    "--future-flag", "--state closed",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-306 rejects edit scope/unknown flag ${flag}, not assignee progress`, () => {
      deny(bash("gh issue edit 7 -R example/product " + flag));
      allow(bash("gh issue edit 7 -R example/product --add-assignee alice --remove-assignee bob"));
    });
  }
  for (const [allowedCommand, deniedCommand] of [
    ["gh issue comment 7 -R example/product --body progress", "gh issue comment 7 -R example/product --edit-last --body progress"],
    ["gh issue comment 7 -R example/product --body-file notes", "gh issue comment 7 -R example/product --delete-last"],
    ["gh issue comment 7 -R example/product --attach notes --body progress", "gh issue comment 7 -R example/product --future-flag"],
    ["gh issue close 7 -R example/product --reason completed --comment shipped", "gh issue close 7 -R example/product --reason duplicate"],
    ["gh issue close 7 -R example/product --reason 'not planned'", "gh issue close 7 -R example/product --duplicate-of 8"],
    ["gh issue reopen 7 -R example/product --comment resumed", "gh issue reopen 7 -R example/product --title new"],
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-306 allows documented progress flags but not ${deniedCommand}`, () => { allow(bash(allowedCommand!)); deny(bash(deniedCommand!)); });
  }
  for (const command of [
    "gh api repos/example/product/issues/7",
    "gh api /repos/example/product/issues/7 -X GET",
    "gh api https://api.github.com/repos/example/product/issues/7 --method=get",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-307 allows only plain GET API form ${command}`, () => {
      for (const role of ["manager", "child"] as const) allow(bash(command, role));
    });
  }
  for (const command of [
    "gh api -X PUT repos/{owner}/{repo}/issues/7/labels -f 'labels[]=x'",
    "gh api --method delete /repos/example/product/issues/comments/9",
    "gh api repos/example/product/pulls/3/reviews -f event=APPROVE",
    "gh api repos/example/product/releases -f tag_name=v2",
    "gh api --method GET repos/example/product/issues/7 --field state=closed",
    "gh api graphql --input body.json",
    "gh api graphql -F query=@query.graphql",
    "gh api graphql -f 'query=query { viewer { login } }'",
    "gh api graphql -f 'query=mutation { createRef(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=mutation { createIssue(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=mutation { updateIssue(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=mutation M($id: ID!) { addLabelsToLabelable(input: {labelableId: $id}) { clientMutationId } }'",
    "gh api graphql -f 'query=mutation { m: closeIssue(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=query { viewer { login } } mutation { markIssueAsDuplicate(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=fragment F on User { login } mutation { addBlockedBy(input: {}) { clientMutationId } }'",
    "gh api graphql -f 'query=mutation { createRef(input: {name: \"createIssue\"}) { ref { name } } }'",
    'gh api graphql -f "query=$QUERY"',
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-307 refuses final-contract API form ${command}`, () => {
      for (const role of ["manager", "child"] as const) { deny(bash(command, role)); allow(bash("gh api repos/example/product/issues/7", role)); }
    });
  }
});

describe("whole-call code and strict mentions [R3.3; final review decisions]", () => {
  for (const command of [
    "sh -c 'gh issue view 7'", "bash -c 'gh issue create'",
    "eval 'gh issue view 7'", "printf 'gh issue create' | sh",
    "xargs gh issue view", "env -S 'gh issue view 7'",
    "env X=1 gh issue view 7", "time gh issue view 7", "timeout 1 gh issue view 7",
    "for x in 7; do gh issue view $x; done", "if true; then gh issue view 7; fi",
    "{ gh issue view 7; }", "(gh issue view 7)",
    "CMD=gh; $CMD issue view 7", "PAGER=malicious gh issue view 7",
    "GH_PAGER=malicious gh issue view 7", "EDITOR=malicious gh issue edit 7 -R example/product --add-assignee alice",
    "gh issue view 7; bash other.sh", "gh issue view 7 | xargs bash",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-308 denies code-fed/wrapped form ${command}, not a plain compound read`, () => {
      for (const role of ["manager", "child"] as const) { deny(bash(command, role)); allow(bash("cd ../app && gh issue view 7 | head", role)); }
    });
  }
  for (const runtime of ["bun", "node"]) {
    for (const flag of ["-e", "-eCODE", "--eval=CODE", "-pCODE", "--print", "--print=CODE", "--preload=hook", "--preload hook", "-rhook", "--require=hook", "--import=hook", "--loader=hook"]) {
      test(`[REQ-13, REQ-15, REQ-16] TEST-308 refuses ${runtime} ${flag} even beside a read or a mentioned launcher`, () => {
        deny(bash(`${runtime} ${flag} 'gh issue create'`));
        deny(bash(`${runtime} ${flag} hook ${launcher} ${flags} --print-line`));
        allow(bash(`bun --no-env-file ${launcher} ${flags} --print-line`));
      });
    }
  }
  for (const command of [
    "X=$(gh issue create)", "X=`gh issue create`",
    'echo >"$(gh issue create)"', "echo >`gh issue create`",
    "cat <(gh issue view 7)", "cat >(gh issue create)",
    'gh issue comment 7 -R example/product --body "$(date)"',
    "X=$(date); gh issue view 7", "gh issue view 7; cat <(date)",
    "gh issue view 7; X=$(date)",
    "cat <<EOF\n$(gh issue create)\nEOF",
    "cat <<-EOF\n\t`gh issue create`\n\tEOF",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-309 denies substitution anywhere in ${command}`, () => {
      for (const role of ["manager", "child"] as const) deny(bash(command, role));
      allow(bash("echo '$(gh issue create)'"));
    });
  }
  for (const command of [
    "grep 'gh issue' notes", "rg 'gh issue' notes", "cat ticket-window.ts",
    "head ticket-window.ts", "tail ticket-window.ts", "wc ticket-window.ts",
    "ls ticket-window.ts", "stat ticket-window.ts", "file ticket-window.ts",
    "echo 'gh issue create'", "printf '%s' 'gh issue create'",
    "git add scripts/ticket-window.ts", "git diff -- scripts/ticket-window.ts",
    "git log -- scripts/ticket-window.ts", "git show HEAD:scripts/ticket-window.ts",
    "git status -- scripts/ticket-window.ts", "git commit -m 'gh issue create is restricted'",
    "bun test scripts/ticket-window.spec.ts",
    "bun --no-env-file scripts/orch-state.ts block 'gh issue awaits triage'",
    "bun --env-file /dev/null scripts/ticket-ref.ts '#7'",
    "X=literal; gh issue view 7", "command -v gh; gh issue view 7",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-310 permits strict literal mention/read form ${command}`, () => allow(bash(command)));
  }
  for (const command of [
    "GIT_PAGER=evil git log -- ticket-window.ts", "git -c core.pager=evil log -- ticket-window.ts",
    "git --paginate diff -- ticket-window.ts", "git diff --ext-diff -- ticket-window.ts",
    "git diff --textconv -- ticket-window.ts", "git log --config-env=core.pager=X -- ticket-window.ts",
    "git grep -Oevil ticket-window.ts", "git blame ticket-window.ts",
    "env X=1 grep 'gh issue' notes", "FOO=1 echo 'gh issue create'",
    "unknown 'gh issue view 7'", "bun 'gh issue view 7'", "node 'gh issue view 7'",
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-310 refuses non-allowlisted mention form ${command}`, () => {
      deny(bash(command));
      allow(bash("grep 'gh issue' notes"));
    });
  }
  for (const [safe, unsafe] of [
    ["cat > x.sh <<'EOF'\ngh issue create\nEOF", "cat > x.sh <<'EOF'\ngh issue create\nEOF\nbash x.sh"],
    ["cat > x.sh <<'EOF'\ngh issue create\nEOF\ngit add x.sh", "cat > x.sh <<'EOF'\ngh issue create\nEOF\n./x.sh"],
    ["cat > x.sh <<'EOF'\ngh issue create\nEOF\ncat x.sh", "cat > x.sh <<'EOF'\ngh issue create\nEOF\nsource x.sh"],
    ["cat > x.sh <<'EOF'\ngh issue create\nEOF\nprintf done", "cat > x.sh <<'EOF'\ngh issue create\nEOF\n. x.sh"],
    ["cat > job <<'EOF'\ngh issue create\nEOF\nwc job", "cat > job <<'EOF'\ngh issue create\nEOF\njob"],
    ["cat > x.ts <<'EOF'\ngh issue create\nEOF", "cat > x.ts <<'EOF'\ngh issue create\nEOF\nbun x.ts"],
    ["cat > x.js <<'EOF'\ngh issue create\nEOF", "cat > x.js <<'EOF'\ngh issue create\nEOF\nnode x.js"],
  ]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-311 refuses a heredoc-written file run in the same call: ${unsafe!.split("\n").at(-1)}`, () => {
      for (const role of ["manager", "child"] as const) { allow(bash(safe!, role)); deny(bash(unsafe!, role)); }
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-311 literal data readers do not execute body text, but shells and piped bodies do", () => {
    const body = "gh issue create --title literal\n$(gh issue create)\n";
    for (const prefix of [
      "bun --no-env-file scripts/orch-state.ts tasks",
      "git commit -F -", "cat > notes",
    ]) allow(bash(prefix + " <<'EOF'\n" + body + "EOF"));
    allow(bash("gh issue comment 7 -R example/product --body-file - <<'EOF'\n" + body + "EOF"));
    for (const prefix of ["bash", "sh", "eval", "xargs", "unknown"]) deny(bash(prefix + " <<'EOF'\n" + body + "EOF"));
    deny(bash("cat <<'EOF' | bash\n" + body + "EOF"));
    deny(bash("cat >(bash) <<'EOF'\n" + body + "EOF"));
    deny(bash("cat <<EOF\n" + body + "EOF"));
  });
});

describe("tracker MCP shapes [R3.1, R3.3; §4.3 and final decisions]", () => {
  const allServers = ["linear-server", "jira", "youtrack", "shortcut", "clickup", "asana"];
  const issueServers = ["github", "gitlab", "atlassian"];
  for (const server of [...allServers, ...issueServers]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-312 ${server} reads pass and an unfamiliar issue write fails`, () => {
      expect(isTrackerTool(server, "update_issue")).toBe(true);
      for (const name of ["get_issue", "list_issues", "search_issues", "extract_issue", "issue_read", "getJiraIssue", "listIssues", "searchIssues"]) {
        expect(isTrackerRead(name)).toBe(true);
        for (const role of ["manager", "child"] as const) allow(mcp(`mcp__${server}__${name}`, { id: "DEMO-8" }, role));
      }
      deny(mcp(`mcp__${server}__${server === "atlassian" ? "unknownJiraIssueWrite" : "unknown_issue_write"}`, { id: "DEMO-7" }));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-312 server and read-name boundaries do not overmatch", () => {
    expect(mcpToolParts("mcp__linear-server__save_issue")).toEqual({ server: "linear-server", name: "save_issue" });
    expect(mcpToolParts("Bash")).toBeNull();
    expect(isTrackerTool("github", "create_release")).toBe(false);
    expect(isTrackerTool("other", "update_issue")).toBe(false);
    expect(isTrackerTool("linear-server", "save_document")).toBe(true);
    expect(isTrackerRead("getaway_issue")).toBe(false);
    expect(isTrackerRead("update_issue")).toBe(false);
    allow(mcp("mcp__other__update_issue", { title: "x" }));
    allow(mcp("mcp__github__create_release", { title: "x" }));
  });

  for (const target of ["id", "issueId", "issue_id", "issue", "number", "issue_number", "issueNumber"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-313 manager status update matches target ${target} case-insensitively, not another ticket`, () => {
      allow(mcp("mcp__linear-server__update_issue", { [target]: "demo-7", state: "Done", assignee: "me" }));
      deny(mcp("mcp__linear-server__update_issue", { [target]: "DEMO-8", state: "Done" }));
    });
  }
  for (const name of ["update_issue", "save_issue", "issue_write"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-313 permits own ${name} state/assignee/links but not missing/creating target`, () => {
      const method = name === "issue_write" ? { method: "update" } : {};
      allow(mcp(`mcp__linear-server__${name}`, { ...method, id: "DEMO-7", state: "Done", assignee: "me", links: [{ url: "https://example.test/report", title: "proof" }] }));
      deny(mcp(`mcp__linear-server__${name}`, { ...method, state: "Done" }));
      if (name === "issue_write") {
        deny(mcp("mcp__linear-server__issue_write", { id: "DEMO-7", state: "Done" }));
        deny(mcp("mcp__linear-server__issue_write", { method: "create", id: "DEMO-7" }));
      }
    });
  }
  for (const target of ["issueId", "issue_id", "issue", "number", "issue_number", "issueNumber"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-313 new comment/reply uses ${target} and never comment id as ownership`, () => {
      allow(mcp("mcp__linear-server__save_comment", { [target]: "DEMO-7", body: "progress", parentId: "thread" }));
      deny(mcp("mcp__linear-server__save_comment", { [target]: "DEMO-8", body: "progress" }));
      deny(mcp("mcp__linear-server__save_comment", { [target]: "DEMO-7", id: "comment", body: "edited" }));
      deny(mcp("mcp__linear-server__save_comment", { [target]: "DEMO-7", commentId: "comment", body: "edited" }));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-313 comment parent scopes and target precedence cannot change another ticket", () => {
    for (const field of ["projectId", "initiativeId", "documentId", "milestoneId", "statusUpdateId"]) {
      deny(mcp("mcp__linear-server__save_comment", { issueId: "DEMO-7", [field]: "parent", body: "x" }));
    }
    deny(mcp("mcp__linear-server__delete_comment", { issueId: "DEMO-7" }));
    deny(mcp("mcp__linear-server__save_comment", { id: "DEMO-7", body: "x" }));
    deny(mcp("mcp__linear-server__save_comment", { issueId: "DEMO-8", issue: "DEMO-7", body: "x" }));
    deny(mcp("mcp__linear-server__update_issue", { id: "DEMO-8", issueId: "DEMO-7", state: "Done" }));
    allow(mcp("mcp__linear-server__save_comment", { issueId: "DEMO-7", body: "x" }));
  });
  for (const name of ["create_attachment", "prepare_attachment_upload", "create_attachment_from_upload"]) {
    for (const target of ["issue", "issueId", "issue_id"]) {
      test(`[REQ-13, REQ-15, REQ-16] TEST-313 own ${name} by ${target} allowed; foreign and id-only attachment denied`, () => {
        allow(mcp(`mcp__linear-server__${name}`, { [target]: "DEMO-7", title: "log", url: "https://example.test/log" }));
        deny(mcp(`mcp__linear-server__${name}`, { [target]: "DEMO-8" }));
        deny(mcp(`mcp__linear-server__${name}`, { id: "DEMO-7" }));
      });
    }
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-313 pre-attachment file upload is allowed only for manager, not child", () => {
    allow(mcp("mcp__linear-server__prepare_file_upload", { filename: "log.txt", contentType: "text/plain", size: 12 }));
    deny(mcp("mcp__linear-server__prepare_file_upload", { filename: "log.txt", contentType: "text/plain", size: 12 }, "child"));
    deny(mcp("mcp__linear-server__delete_attachment", { issue: "DEMO-7" }));
  });
  test("[REQ-13, REQ-15, REQ-16] TEST-313 GitHub MCP writes need owner and repo as well as the number", () => {
    const own = { owner: "EXAMPLE", repo: "PRODUCT", issue_number: 7, state: "closed" };
    allow(mcp("mcp__github__update_issue", own, "manager", github));
    for (const input of [{ ...own, owner: "other" }, { ...own, repo: "other" }, { issue_number: 7, state: "closed" }, { ...own, issue_number: 8 }]) deny(mcp("mcp__github__update_issue", input, "manager", github));
    deny(mcp("mcp__github__update_issue", own, "manager", { ...github, repo: null }));
    expect(deny(mcp("mcp__github__add_issue_comment", { owner: "other", repo: "product", issue_number: 7, body: "x" }, "manager", github))).toMatch(/gh pr comment/);
  });
  for (const field of ["labels", "addLabels", "removeLabels", "title", "description", "body", "patch", "parentId", "projectId", "relations", "removeRelatedTo", "unknownField"]) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-314 refuses unlisted update field ${field} by name, not a known state update`, () => {
      expect(deny(mcp("mcp__linear-server__save_issue", { id: "DEMO-7", [field]: "x" }))).toContain(field);
      allow(mcp("mcp__linear-server__save_issue", { id: "DEMO-7", state: "Done" }));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-314 state reasons reject duplicate while ordinary reasons pass", () => {
    for (const field of ["state_reason", "stateReason"]) {
      allow(mcp("mcp__linear-server__update_issue", { id: "DEMO-7", state: "Done", [field]: "completed" }));
      deny(mcp("mcp__linear-server__update_issue", { id: "DEMO-7", state: "Done", [field]: "duplicate" }));
    }
  });
  test("[REQ-13, REQ-15, REQ-16] TEST-314 UUID refusal names the key, while no-ticket refusal names registration", () => {
    const uuid = "bb836761-5bd2-4a96-bc3c-957f507a7203";
    const why = deny(mcp("mcp__linear-server__save_issue", { id: uuid, state: "Done" }), /key/);
    expect(why).toContain("DEMO-7");
    expect(why).toMatch(/triage/);
    const none = deny(mcp("mcp__linear-server__save_issue", { id: "DEMO-7", state: "Done" }, "manager", null));
    expect(none).toMatch(/no ticket recorded/i);
    expect(none).toMatch(/orchestrator:manager/);
  });
  for (const [name, input] of [
    ["save_issue", { id: "DEMO-7", state: "Done" }],
    ["save_comment", { issueId: "DEMO-7", body: "progress" }],
    ["create_attachment", { issue: "DEMO-7" }], ["create_issue", { title: "x" }],
    ["transitionJiraIssue", { issue: "DEMO-7" }],
  ] as const) {
    test(`[REQ-13, REQ-15, REQ-16] TEST-315 child refuses even own tracker write ${name}, but manager can read`, () => {
      deny(mcp(`mcp__linear-server__${name}`, input, "child"), /manager/);
      allow(mcp("mcp__linear-server__get_issue", { id: "DEMO-7" }, "child"));
    });
  }
  test("[REQ-13, REQ-15, REQ-16] TEST-316 unrelated tools and lines without trigger words are outside the guard", () => {
    for (const command of ["git status", "bun scripts/check.ts", "node -e 'console.log(1)'", "curl https://example.test", "./earlier-script.sh"]) allow(bash(command));
    allow(decide({ role: "child", own: keyed, toolName: "Read", toolInput: { file_path: launcher } }));
    allow(mcp("mcp__unlisted__create_issue", { title: "x" }, "child"));
  });
});
