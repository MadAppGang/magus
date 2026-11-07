import { describe, expect, test } from "bun:test";
import {
  parseTicketRef,
  colourForLabels,
  buildTicketName,
  repoFromRemoteUrl,
} from "./ticket";

describe("tracker reference normalization", () => {
  test("TEST-61 [REQ-38] resolves trimmed local issue numbers without inventing a repository", () => {
    for (const repo of [null, "Example/Console"] as const) {
      for (const ref of ["#7", " \t#007\n", "#0000007"]) {
        expect(parseTicketRef(ref, repo)).toEqual({
          tracker: "github", id: "#7", slug: "gh-7", repo, number: 7,
        });
      }
    }
  });

  test("TEST-62 [REQ-38] compares qualified repositories case-insensitively but preserves their spelling", () => {
    const cases = [
      { ref: "Example/Console#007", here: "example/console", repo: "Example/Console", slug: "gh-7" },
      { ref: "Example/Console#7", here: null, repo: "Example/Console", slug: "console-7" },
      { ref: "Other/Console#7", here: "Example/Console", repo: "Other/Console", slug: "console-7" },
      { ref: "Other/APIDocs_v2.test-Tools#7", here: null, repo: "Other/APIDocs_v2.test-Tools", slug: "apidocs_v2.test-tools-7" },
    ];

    for (const { ref, here, repo, slug } of cases) {
      expect(parseTicketRef(" \t" + ref + "\n", here)).toEqual({
        tracker: "github", id: repo + "#7", slug, repo, number: 7,
      });
    }
  });

  test("TEST-63 [REQ-39] normalizes GitHub issue URLs including the documented scheme, host and suffix variants", () => {
    for (const scheme of ["http", "https"]) {
      for (const host of ["github.com", "www.github.com"]) {
        for (const suffix of ["", "/", "?tab=activity", "#issuecomment-9", "/?tab=activity#issuecomment-9"]) {
          const url = scheme + "://" + host + "/Example/Console/issues/0007" + suffix;
          const expected = {
            tracker: "github" as const, id: "Example/Console#7", repo: "Example/Console", number: 7,
          };

          expect(parseTicketRef(" \t" + url + "\n", "example/console")).toEqual({
            ...expected, slug: "gh-7",
          });
          expect(parseTicketRef(url, null)).toEqual({ ...expected, slug: "console-7" });
        }
      }
    }
  });

  test("TEST-64 [REQ-40] leaves bare ASCII keys tracker-neutral while normalizing case and number", () => {
    const cases = [
      { ref: "abc-007", id: "ABC-7", slug: "abc-7" },
      { ref: " A1b-00012 \n", id: "A1B-12", slug: "a1b-12" },
      { ref: "Z-1", id: "Z-1", slug: "z-1" },
    ];

    for (const { ref, id, slug } of cases) {
      expect(parseTicketRef(ref, "Example/Console")).toEqual({
        tracker: "key", id, slug, repo: null, number: null,
      });
    }
  });

  test("TEST-65 [REQ-40] identifies Linear only from its issue URL and ignores an optional title path", () => {
    for (const suffix of ["", "/", "/a-title", "/a-title/another-segment"]) {
      expect(parseTicketRef(" \thttps://linear.app/example/issue/a1b-0007" + suffix + "\n", null)).toEqual({
        tracker: "linear", id: "A1B-7", slug: "a1b-7", repo: null, number: null,
      });
    }
  });

  test("TEST-66 [REQ-38, REQ-39, REQ-40] returns null for unsupported refs, pull requests and lookalike hosts", () => {
    const invalid = [
      "", " \t\n", "7", "#", "owner/repo", "owner/repo#",
      "1ABC-7", "_ABC-7", "ABC_DEF-7", "AB-CD-7", "ABC -7", "ABC- 7",
      "ABC-7\njunk", "éBC-7", "ABC-7-extra",
      "https://github.com/Example/Console/pull/7",
      "http://www.github.com/Example/Console/pull/7/",
      "https://github.com/Example/Console/pulls/7",
      "https://github.com/Example/Console/issues",
      "https://github.com/Example/Console/issues/7/extra",
      "https://github.com/Example/Console/issues/not-a-number",
      "https://github.com.evil.test/Example/Console/issues/7",
      "https://notgithub.com/Example/Console/issues/7",
      "https://gitlab.com/Example/Console/issues/7",
      "https://github.com/Example/Console/discussions/7",
      "https://linear.app/example/project/ABC-7",
      "https://linear.app/example/issue/1ABC-7",
      "https://linear.app/example/issue/ABC-0",
      "https://linear.app.evil.test/example/issue/ABC-7",
      "http://linear.app/example/issue/ABC-7",
      "prefix https://github.com/Example/Console/issues/7",
    ];

    for (const ref of invalid) {
      expect(parseTicketRef(ref, null)).toBeNull();
    }
  });

  test("TEST-67 [REQ-38, REQ-39, REQ-40] rejects zero and nondecimal numbers in every reference form", () => {
    const forms = [
      (n: string) => "#" + n,
      (n: string) => "Example/Console#" + n,
      (n: string) => "https://github.com/Example/Console/issues/" + n,
      (n: string) => "ABC-" + n,
      (n: string) => "https://linear.app/example/issue/ABC-" + n,
    ];

    for (const form of forms) {
      for (const number of ["0", "000", "-1", "+1", "1.5", "1e3", "NaN", "Infinity"]) {
        expect(parseTicketRef(form(number), null)).toBeNull();
      }
    }
    expect(parseTicketRef("#9007199254740991", null)).toEqual({
      tracker: "github", id: "#9007199254740991", slug: "gh-9007199254740991",
      repo: null, number: 9007199254740991,
    });
  });
});

describe("label-derived colours", () => {
  test("TEST-68 [REQ-41] recognizes every keyword and exactly its s and es suffixes", () => {
    const groups = [
      { colour: "red", keywords: ["bug", "bugfix", "fix", "defect"] },
      { colour: "green", keywords: ["feature", "enhancement", "feat"] },
      { colour: "blue", keywords: ["improvement", "chore", "refactor", "perf"] },
    ] as const;

    for (const { colour, keywords } of groups) {
      for (const keyword of keywords) {
        for (const suffix of ["", "s", "es"]) {
          expect(colourForLabels([keyword + suffix])).toBe(colour);
          expect(colourForLabels([(keyword + suffix).toUpperCase()])).toBe(colour);
        }
      }
    }
  });

  test("TEST-69 [REQ-41] splits labels on runs of non-ASCII-alphanumeric characters", () => {
    const cases = [
      { labels: ["type: BUGFIXES"], colour: "red" },
      { labels: ["status/Enhancements"], colour: "green" },
      { labels: ["area__REFACTOR"], colour: "blue" },
      { labels: ["type...Fixes!!!"], colour: "red" },
      { labels: ["ui—FEAT"], colour: "green" },
      { labels: ["ops + PERFs / misc"], colour: "blue" },
      { labels: ["ébugé"], colour: "red" },
    ] as const;

    for (const { labels, colour } of cases) {
      expect(colourForLabels(labels)).toBe(colour);
    }
  });

  test("TEST-70 [REQ-41] gives red precedence over green and blue regardless of label or word order", () => {
    const permutations = [
      ["bug", "feature", "chore"], ["bug", "chore", "feature"],
      ["feature", "bug", "chore"], ["feature", "chore", "bug"],
      ["chore", "bug", "feature"], ["chore", "feature", "bug"],
    ];

    for (const labels of permutations) {
      expect(colourForLabels(labels)).toBe("red");
      expect(colourForLabels([labels.join(" / ")])).toBe("red");
    }
    expect(colourForLabels(["chore", "enhancement"])).toBe("green");
    expect(colourForLabels(["enhancement", "chore"])).toBe("green");
    expect(colourForLabels(["refactor feature"])).toBe("green");
    expect(colourForLabels(["misc", "perf"])).toBe("blue");
  });

  test("TEST-71 [REQ-41] returns null for empty labels and keywords embedded inside a larger word", () => {
    const labels = [
      "", " \t\n", "documentation", "prefix", "debug", "buggy", "debugger",
      "featured", "featurette", "prefeature", "choreography", "performance",
      "perfume", "refactoring", "improvementish", "bug2", "2bug", "fix99",
      "featuresx", "bugsfix", "featses",
    ];

    expect(colourForLabels([])).toBeNull();
    for (const label of labels) {
      expect(colourForLabels([label])).toBeNull();
    }
    expect(colourForLabels(labels)).toBeNull();
  });
});

describe("bounded window names", () => {
  test("TEST-72 [REQ-42] strips punctuation, lowercases and counts only nonempty title words", () => {
    const cases = [
      { slug: "abc-7", words: ["Fix!", "LOGIN"], expected: "abc-7-fix-login" },
      { slug: "gh-7", words: ["One", "T.W.O", "Three"], expected: "gh-7-one-two-three" },
      { slug: "repo.v2_x-7", words: ["A", "B", "C", "D"], expected: "repo.v2_x-7-a-b-c-d" },
      { slug: "0", words: ["", "!!!", "API_v2", "dash-word", "é"], expected: "0-apiv2-dashword" },
      { slug: "a", words: [" \t", "one two", "THREE.4", "🤖"], expected: "a-onetwo-three4" },
    ];

    for (const { slug, words, expected } of cases) {
      const name = buildTicketName(slug, words);

      expect(name).toBe(expected);
      expect(name).toMatch(/^[a-z0-9][a-z0-9._-]{0,47}$/);
    }
  });

  test("TEST-73 [REQ-42] rejects fewer than two or more than four words after stripping", () => {
    const invalid = [
      [], [""], ["one"], ["one", "!!!"], ["", "🤖", "..."],
      ["one", "two", "three", "four", "five"],
      ["a".repeat(30), "b", "c", "d", "e"],
    ];

    for (const words of invalid) {
      expect(() => buildTicketName("gh-7", words)).toThrow(Error);
    }
  });

  test("TEST-74 [REQ-42] accepts the slug pattern without normalizing invalid slugs into it", () => {
    for (const slug of ["a", "0", "abc-7", "repo.v2_name--7"]) {
      expect(buildTicketName(slug, ["one", "two"])).toBe(slug + "-one-two");
    }
    for (const slug of [
      "", "ABC-7", ".repo", "_repo", "-repo", "repo/name", "repo name",
      "repo\nname", "repo;run", "repo+name", "repo:name", "é",
    ]) {
      expect(() => buildTicketName(slug, ["one", "two"])).toThrow(Error);
    }
  });

  test("TEST-75 [REQ-42] keeps names at 48 characters and drops the final word only when longer", () => {
    const first = "a".repeat(40);

    expect(buildTicketName("gh-7", [first, "bb"])).toBe("gh-7-" + first + "-bb");
    expect(buildTicketName("gh-7", [first, "bbb"])).toBe("gh-7-" + first);
    expect(buildTicketName("gh-7", [first, "bb"])).toHaveLength(48);
  });

  test("TEST-76 [REQ-42] repeatedly drops trailing words and may leave only one title word", () => {
    const first = "a".repeat(43);
    const name = buildTicketName("gh-7", [first, "two", "three", "four"]);

    expect(name).toBe("gh-7-" + first);
    expect(name).toHaveLength(48);
  });

  test("TEST-77 [REQ-42] throws when the slug plus the first word cannot fit instead of deleting or truncating it", () => {
    expect(() => buildTicketName("gh-7", ["a".repeat(44), "b"])).toThrow(Error);
    expect(() => buildTicketName("s".repeat(47), ["a", "b"])).toThrow(Error);
    expect(() => buildTicketName("s".repeat(49), ["one", "two"])).toThrow(Error);
  });
});

describe("GitHub remote recognition", () => {
  test("TEST-78 [REQ-43] extracts trimmed GitHub remotes and removes one terminal .git suffix", () => {
    const remotes = [
      "git@github.com:Example/Console",
      "git@github.com:Example/Console.git",
      "ssh://git@github.com/Example/Console",
      "ssh://git@github.com/Example/Console.git",
      "https://github.com/Example/Console",
      "https://github.com/Example/Console.git",
      "https://github.com/Example/Console/",
      "https://github.com/Example/Console.git/",
    ];

    for (const remote of remotes) {
      expect(repoFromRemoteUrl(" \t" + remote + "\n")).toBe("Example/Console");
    }
    expect(repoFromRemoteUrl("https://github.com/Example/Console.git.git/")).toBe("Example/Console.git");
    expect(repoFromRemoteUrl("git@github.com:Example/a.b_c-d.git")).toBe("Example/a.b_c-d");
  });

  test("TEST-79 [REQ-43] returns null for other hosts, protocols and remote shapes", () => {
    const invalid = [
      "", " \n", "Example/Console", "git@github.com:Example",
      "git@github.com:/Console", "git@github.com:Example/",
      "git@gitlab.com:Example/Console.git", "git@github.com.evil.test:Example/Console.git",
      "https://github.com.evil.test/Example/Console.git",
      "https://notgithub.com/Example/Console.git",
      "https://gitlab.com/Example/Console.git",
      "http://github.com/Example/Console.git", "git://github.com/Example/Console.git",
      "https://github.com/Example", "https://github.com/Example/Console/extra",
      "https://github.com/Example/Console.git?ref=main",
      "https://github.com/Example/Console#main",
      "https://github.com//Console", "https://github.com/Example/",
      "ssh://git@github.com/Example/Console/extra",
      "ssh://git@other.test/Example/Console.git",
      "ssh://github.com/Example/Console.git",
      "git@github.com:Example/Console/extra",
      "git@github.com:Example/Console.git/",
      "ssh://git@github.com/Example/Console/",
      "https://git@github.com/Example/Console.git",
      "https://github.com:8443/Example/Console.git",
      "/local/repositories/Console.git", "file:///local/Console.git",
    ];

    for (const remote of invalid) {
      expect(repoFromRemoteUrl(remote)).toBeNull();
    }
  });
});

describe("readonly core inputs", () => {
  test("TEST-80 [REQ-44] accepts frozen label and word arrays without changing them between calls", () => {
    const labels = Object.freeze(["Misc", "TYPE: Features", "Area / BUGFIXES"]);
    const words = Object.freeze(["Fix!", "THE", "input_box", "..."]);

    expect(colourForLabels(labels)).toBe("red");
    expect(buildTicketName("gh-7", words)).toBe("gh-7-fix-the-inputbox");
    expect(colourForLabels(labels)).toBe("red");
    expect(buildTicketName("gh-7", words)).toBe("gh-7-fix-the-inputbox");
    expect(labels).toEqual(["Misc", "TYPE: Features", "Area / BUGFIXES"]);
    expect(words).toEqual(["Fix!", "THE", "input_box", "..."]);
  });
});
