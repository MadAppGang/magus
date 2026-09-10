import { describe, expect, test } from "bun:test";
import { discoveryTarget } from "./redirect-search-to-facade";

describe("discoveryTarget — bare identifier searches", () => {
  test("redirects rg searches for a plain code identifier", () => {
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
  });

  test("redirects recursive grep searches for a plain code identifier", () => {
    expect(discoveryTarget("grep -rn saveSettings src/")).toBe("saveSettings");
  });

  test("recognizes the content-search binaries in scope", () => {
    for (const binary of ["rg", "grep", "egrep", "fgrep", "ag", "ack", "ripgrep"]) {
      expect(discoveryTarget(`${binary} handleRequest`)).toBe("handleRequest");
    }
  });

  test("returns an unquoted identifier when the identifier itself is quoted", () => {
    expect(discoveryTarget(`rg "withFileLock"`)).toBe("withFileLock");
    expect(discoveryTarget("grep 'saveSettings' src/")).toBe("saveSettings");
  });
});

describe("discoveryTarget — questions an index answers no better", () => {
  test("allows patterns containing regex metacharacters", () => {
    for (const command of [
      `rg "foo.*bar"`,
      `rg "foo[0-9]"`,
      `rg "foo(bar)"`,
      `rg "foo|bar"`,
      `rg "^handleRequest$"`,
      `grep "UserService\\.find" src/`,
      `grep "foo+" src/`,
      `grep "foo?" src/`,
    ]) {
      expect(discoveryTarget(command)).toBeUndefined();
    }
  });

  test("allows quoted phrases containing whitespace", () => {
    expect(discoveryTarget(`rg "permission denied"`)).toBeUndefined();
    expect(discoveryTarget("grep 'hello world' src/")).toBeUndefined();
  });

  test("allows count queries", () => {
    expect(discoveryTarget("rg -c handleRequest")).toBeUndefined();
    expect(discoveryTarget("rg --count handleRequest")).toBeUndefined();
    expect(discoveryTarget("grep -rc handleRequest src/")).toBeUndefined();
  });

  test("allows matched-substring-only queries", () => {
    expect(discoveryTarget("rg -o handleRequest")).toBeUndefined();
    expect(discoveryTarget("rg --only-matching handleRequest")).toBeUndefined();
    expect(discoveryTarget("grep -ro handleRequest src/")).toBeUndefined();
  });

  test("allows file-list queries by default", () => {
    expect(discoveryTarget("grep -l handleRequest src/")).toBeUndefined();
    expect(discoveryTarget("grep -L handleRequest src/")).toBeUndefined();
    expect(discoveryTarget("rg --files-with-matches handleRequest")).toBeUndefined();
  });

  test("finds file-list flags inside combined short-option groups", () => {
    expect(discoveryTarget("grep -rli handleRequest src/")).toBeUndefined();
    expect(discoveryTarget("grep -rnL handleRequest src/")).toBeUndefined();
  });

  test("reclassifies file-list queries as location queries when requested", () => {
    expect(discoveryTarget("grep -l handleRequest src/", { listIsLocation: true })).toBe(
      "handleRequest",
    );

    expect(discoveryTarget("grep -L handleRequest src/", { listIsLocation: true })).toBe(
      "handleRequest",
    );

    expect(
      discoveryTarget("rg --files-with-matches handleRequest", { listIsLocation: true }),
    ).toBe("handleRequest");

    expect(discoveryTarget("grep -rli handleRequest src/", { listIsLocation: true })).toBe(
      "handleRequest",
    );
  });

  test("listIsLocation does not reclassify count or only-matching queries", () => {
    expect(discoveryTarget("rg --count handleRequest", { listIsLocation: true })).toBeUndefined();

    expect(
      discoveryTarget("rg --only-matching handleRequest", { listIsLocation: true }),
    ).toBeUndefined();
  });

  test("allows filename questions", () => {
    expect(discoveryTarget(`find . -name '*.ts'`)).toBeUndefined();
    expect(discoveryTarget(`find . -iname '*.TS'`)).toBeUndefined();
    expect(discoveryTarget(`find . -path '*/src/*'`)).toBeUndefined();
    expect(discoveryTarget(`find . -regex '.*\\.ts'`)).toBeUndefined();
  });

  test("allows patterns shorter than four characters", () => {
    expect(discoveryTarget("rg a")).toBeUndefined();
    expect(discoveryTarget("rg ab")).toBeUndefined();
    expect(discoveryTarget("rg abc")).toBeUndefined();
  });

  test("redirects a four-character identifier", () => {
    expect(discoveryTarget("rg abcd")).toBe("abcd");
  });

  test("allows commands that are not search-shaped", () => {
    for (const command of [
      "npm run build",
      "bun test",
      "git status",
      "tsc --noEmit",
      "curl https://example.com",
      "echo handleRequest",
      "ls -la",
    ]) {
      expect(discoveryTarget(command)).toBeUndefined();
    }
  });

  test("allows pipelines that transform the answer", () => {
    expect(discoveryTarget("rg handleRequest | wc -l")).toBeUndefined();
    expect(discoveryTarget(`rg handleRequest | awk '{ print $1 }'`)).toBeUndefined();
  });

  test("allows output redirection that transforms where the answer goes", () => {
    expect(discoveryTarget("rg handleRequest > search-results.txt")).toBeUndefined();
  });

  test("still redirects when stderr alone is sent to /dev/null", () => {
    expect(discoveryTarget("rg handleRequest 2>/dev/null")).toBe("handleRequest");
  });

  test("still redirects through trailing head, tail, sort, and uniq", () => {
    expect(discoveryTarget("rg handleRequest | head")).toBe("handleRequest");
    expect(discoveryTarget("rg handleRequest | head -n 20")).toBe("handleRequest");
    expect(discoveryTarget("rg handleRequest | tail")).toBe("handleRequest");
    expect(discoveryTarget("rg handleRequest | tail -n 20")).toBe("handleRequest");
    expect(discoveryTarget("rg handleRequest | sort")).toBe("handleRequest");
    expect(discoveryTarget("rg handleRequest | uniq")).toBe("handleRequest");
  });

  test("still redirects through a trailing grep -v exclusion", () => {
    expect(discoveryTarget("rg handleRequest | grep -v test")).toBe("handleRequest");
  });
});

describe("discoveryTarget — value-taking options", () => {
  test("does not mistake separate grep long-option values for the pattern", () => {
    expect(discoveryTarget("grep -rn --exclude-dir node_modules handleRequest .")).toBe(
      "handleRequest",
    );

    expect(discoveryTarget(`grep --include "*.ts" handleRequest src/`)).toBe("handleRequest");

    expect(discoveryTarget("grep --exclude generatedFile handleRequest src/")).toBe(
      "handleRequest",
    );

    expect(discoveryTarget("grep --after-context 3 handleRequest src/")).toBe("handleRequest");

    expect(discoveryTarget("grep --before-context 3 handleRequest src/")).toBe("handleRequest");

    expect(discoveryTarget("grep --context 3 handleRequest src/")).toBe("handleRequest");

    expect(discoveryTarget("grep --max-count 10 handleRequest src/")).toBe("handleRequest");

    expect(discoveryTarget("grep --binary-files without-match handleRequest src/")).toBe(
      "handleRequest",
    );
  });

  test("does not mistake separate grep short-option values for the pattern", () => {
    expect(discoveryTarget("grep -A 3 handleRequest src/")).toBe("handleRequest");
    expect(discoveryTarget("grep -B 3 handleRequest src/")).toBe("handleRequest");
    expect(discoveryTarget("grep -C 3 handleRequest src/")).toBe("handleRequest");
    expect(discoveryTarget("grep -m 10 handleRequest src/")).toBe("handleRequest");
  });

  test("does not mistake separate rg long-option values for the pattern", () => {
    expect(discoveryTarget("rg --type python handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --type-not test handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --glob typescript handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --context 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --after-context 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --before-context 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --max-count 10 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --encoding utf-8 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --engine auto handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --sort path handleRequest")).toBe("handleRequest");
  });

  test("does not mistake separate rg short-option values for the pattern", () => {
    expect(discoveryTarget("rg -t python handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -T test handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -g typescript handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -C 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -A 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -B 3 handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg -m 10 handleRequest")).toBe("handleRequest");
  });

  test("inline option values do not consume the following pattern token", () => {
    expect(discoveryTarget("rg --type=python handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("rg --glob=typescript handleRequest")).toBe("handleRequest");
    expect(discoveryTarget("grep --exclude-dir=node_modules handleRequest .")).toBe(
      "handleRequest",
    );
  });

  test("find value-taking predicates do not become symbol patterns", () => {
    expect(discoveryTarget("find . -user handleRequest")).toBeUndefined();
    expect(discoveryTarget("find . -group engineeringTeam")).toBeUndefined();
    expect(discoveryTarget("find . -newermt referenceDate")).toBeUndefined();
    expect(discoveryTarget("find . -maxdepth 1000")).toBeUndefined();
    expect(discoveryTarget("find . -mindepth 1000")).toBeUndefined();
    expect(discoveryTarget("find . -type fileType")).toBeUndefined();
  });

  test("allows when a value-taking option leaves no unambiguous pattern", () => {
    expect(discoveryTarget("rg --type handleRequest")).toBeUndefined();
    expect(discoveryTarget("grep --exclude-dir node_modules")).toBeUndefined();
    expect(discoveryTarget("rg -C handleRequest")).toBeUndefined();
  });
});

describe("discoveryTarget — command sequencing", () => {
  test("allows newline-separated commands", () => {
    expect(discoveryTarget("rg withFileLock\nnpm run build\nbun test")).toBeUndefined();
  });

  test("allows commands followed by another command through &&", () => {
    expect(discoveryTarget("rg withFileLock && ls")).toBeUndefined();
  });

  test("allows commands followed by another command through a semicolon", () => {
    expect(discoveryTarget("rg withFileLock; ls")).toBeUndefined();
  });

  test("redirects the same search when it is the only command", () => {
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
  });
});
