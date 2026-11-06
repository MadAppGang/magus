import { describe, expect, test } from "bun:test";
import {
  ONE_WORD_IDS,
  renderAnswers,
  scrub,
  selfIdentifyingLines,
} from "./round-answers.ts";

describe("round-answers scrubber", () => {
  describe("ONE_WORD_IDS (REQ-1)", () => {
    test("REQ-1: holds exactly internal, default, opus, sonnet, haiku", () => {
      expect(ONE_WORD_IDS).toBeInstanceOf(Set);
      expect([...ONE_WORD_IDS].sort()).toEqual(
        ["default", "haiku", "internal", "opus", "sonnet"].sort()
      );
      expect(ONE_WORD_IDS.size).toBe(5);
    });
  });

  describe("scrub — anywhere-in-line forms (REQ-2)", () => {
    const ids = ["gpt-example", "kimi-x2"];

    test("REQ-2: replaces I am <id> and I'm <id> (straight and curly apostrophe) anywhere in a line, case-insensitively", () => {
      expect(scrub("Hello, I am gpt-example and I'm ready.", ids)).toBe(
        "Hello, I am [participant] and I'm ready."
      );
      expect(scrub("Note: i'm GPT-EXAMPLE in this run.", ids)).toBe(
        "Note: i'm [participant] in this run."
      );
      expect(scrub("Note: I’m kimi-x2 in this run.", ids)).toBe(
        "Note: I’m [participant] in this run."
      );
    });

    test("REQ-2: replaces my model is <id>, my model ID is <id>, and speaking as <id> anywhere in a line", () => {
      expect(scrub("For context, my model is gpt-example here.", ids)).toBe(
        "For context, my model is [participant] here."
      );
      expect(scrub("Specifically, MY MODEL ID IS kimi-x2.", ids)).toBe(
        "Specifically, MY MODEL ID IS [participant]."
      );
      expect(scrub("Right now, speaking as gpt-example, I agree.", ids)).toBe(
        "Right now, speaking as [participant], I agree."
      );
    });

    test("REQ-2: replaces this/my answer/response/reply was/is written/answered by <id> combinations", () => {
      const variations = [
        [
          "Note that this answer was written by gpt-example.",
          "Note that this answer was written by [participant].",
        ],
        [
          "Note that this response is written by kimi-x2.",
          "Note that this response is written by [participant].",
        ],
        [
          "Note that this reply was answered by gpt-example.",
          "Note that this reply was answered by [participant].",
        ],
        [
          "Note that my answer is answered by kimi-x2.",
          "Note that my answer is answered by [participant].",
        ],
        [
          "Note that my response was written by gpt-example.",
          "Note that my response was written by [participant].",
        ],
        [
          "Note that my reply is written by kimi-x2.",
          "Note that my reply is written by [participant].",
        ],
      ];

      for (const [input, expected] of variations) {
        expect(scrub(input, ids)).toBe(expected);
      }
    });
  });

  describe("scrub — sentence-start forms (REQ-3)", () => {
    const ids = ["gpt-example", "kimi-x2"];

    test("REQ-3: replaces this is <id> at line start, after list markers, and after sentence punctuation", () => {
      expect(scrub("This is gpt-example with a proposal.", ids)).toBe(
        "This is [participant] with a proposal."
      );
      expect(scrub("- this is gpt-example\n* This is kimi-x2\n1. this is gpt-example", ids)).toBe(
        "- this is [participant]\n* This is [participant]\n1. this is [participant]"
      );
      expect(
        scrub(
          "Hello! This is gpt-example. Wait? this is kimi-x2. Done. This is gpt-example",
          ids
        )
      ).toBe(
        "Hello! This is [participant]. Wait? this is [participant]. Done. This is [participant]"
      );
    });

    test("REQ-3: does not replace this is <id> in the middle of a sentence", () => {
      const input = "I know that this is gpt-example and not another.";
      expect(scrub(input, ids)).toBe(input);
    });
  });

  describe("scrub — line-start forms (REQ-4)", () => {
    const ids = ["gpt-example", "kimi-x2"];

    test("REQ-4: replaces <id> here, written by <id>, and answered by <id> at line start or after indent and one list marker", () => {
      expect(scrub("gpt-example here with an analysis.", ids)).toBe(
        "[participant] here with an analysis."
      );
      expect(scrub("  - gpt-example here\n  1. Written by kimi-x2\n* answered by gpt-example", ids)).toBe(
        "  - [participant] here\n  1. Written by [participant]\n* answered by [participant]"
      );
    });

    test("REQ-4: does not replace <id> here, written by <id>, or answered by <id> mid-line", () => {
      const input =
        "We see gpt-example here in the logs. It was written by gpt-example and answered by kimi-x2.";
      expect(scrub(input, ids)).toBe(input);
    });
  });

  describe("scrub — optional 'the' and Markdown wrappers (REQ-5)", () => {
    const ids = ["gpt-example"];

    test("REQ-5: allows optional 'the' between label and ID", () => {
      expect(scrub("I am the gpt-example.", ids)).toBe("I am the [participant].");
      expect(scrub("Speaking as the gpt-example,", ids)).toBe(
        "Speaking as the [participant],"
      );
      expect(scrub("Written by the gpt-example", ids)).toBe(
        "Written by the [participant]"
      );
    });

    test("REQ-5: preserves *, **, _, __, and backtick wrappers around the replaced ID", () => {
      expect(scrub("I am *gpt-example*.", ids)).toBe("I am *[participant]*.");
      expect(scrub("I am **gpt-example**.", ids)).toBe("I am **[participant]**.");
      expect(scrub("I am _gpt-example_.", ids)).toBe("I am _[participant]_.");
      expect(scrub("I am __gpt-example__.", ids)).toBe("I am __[participant]__.");
      expect(scrub("I am `gpt-example`.", ids)).toBe("I am `[participant]`.");
      expect(scrub("I am the **gpt-example**.", ids)).toBe(
        "I am the **[participant]**."
      );
    });
  });

  describe("scrub — ID boundaries and prefix precedence (REQ-6, REQ-7)", () => {
    test("REQ-6: requires the ID to end at a boundary while allowing a sentence-ending period", () => {
      const ids = ["gpt-example"];
      expect(scrub("I am gpt-example-2", ids)).toBe("I am gpt-example-2");
      expect(scrub("I am gpt-example/v1", ids)).toBe("I am gpt-example/v1");
      expect(scrub("I am gpt-example.5", ids)).toBe("I am gpt-example.5");
      expect(scrub("I am gpt-example.", ids)).toBe("I am [participant].");
      expect(scrub("I am gpt-example, and I concur.", ids)).toBe(
        "I am [participant], and I concur."
      );
    });

    test("REQ-7: matches the longer ID when one panel ID is a prefix of another", () => {
      const ids = ["gpt", "gpt-example"];
      expect(scrub("I am gpt-example and I am gpt.", ids)).toBe(
        "I am [participant] and I am [participant]."
      );
    });
  });

  describe("scrub — ONE_WORD_IDS restrictions and non-matching mentions (REQ-8, REQ-9)", () => {
    test("REQ-8: scrubs ONE_WORD_IDS only after I am or I'm", () => {
      const ids = ["internal", "default", "opus", "sonnet", "haiku"];
      expect(scrub("I am internal and I'm opus and I’m sonnet.", ids)).toBe(
        "I am [participant] and I'm [participant] and I’m [participant]."
      );
      expect(scrub("I am the haiku.", ids)).toBe("I am the [participant].");

      const untouched = [
        "This is internal tooling.",
        "This is internal.",
        "internal here",
        "opus here",
        "my model is opus",
        "my model ID is sonnet",
        "speaking as haiku",
        "this answer was written by default",
        "written by internal",
        "answered by sonnet",
      ].join("\n");
      expect(scrub(untouched, ids)).toBe(untouched);
    });

    test("REQ-9: leaves non-self-identifying mentions byte-for-byte unchanged", () => {
      const ids = ["gpt-example"];
      const lines = [
        "Configured model: gpt-example.",
        "The API returns the same model ID as gpt-example.",
        "I compared gpt-example with another model.",
        "as gpt-example does",
        "gpt-example is fast",
      ];
      for (const line of lines) {
        expect(scrub(line, ids)).toBe(line);
      }
    });
  });

  describe("scrub — protected regions and formatting preservation (REQ-10, REQ-11, REQ-12)", () => {
    const ids = ["gpt-example"];

    test("REQ-10: ignores fenced code blocks and only closes on a matching fence char of at least the opening length", () => {
      const text = [
        "I am gpt-example",
        "```ts",
        "I am gpt-example",
        "~~~",
        "I am gpt-example",
        "```",
        "I am gpt-example",
        "````markdown",
        "I am gpt-example",
        "```",
        "I am gpt-example",
        "````",
        "I am gpt-example",
        "~~~",
        "I am gpt-example",
        "~~~~",
        "I am gpt-example",
      ].join("\n");

      const expected = [
        "I am [participant]",
        "```ts",
        "I am gpt-example",
        "~~~",
        "I am gpt-example",
        "```",
        "I am [participant]",
        "````markdown",
        "I am gpt-example",
        "```",
        "I am gpt-example",
        "````",
        "I am [participant]",
        "~~~",
        "I am gpt-example",
        "~~~~",
        "I am [participant]",
      ].join("\n");

      expect(scrub(text, ids)).toBe(expected);
    });

    test("REQ-10: does not close a fence when the closing line has trailing text", () => {
      const text = [
        "```",
        "I am gpt-example",
        "``` not a closing fence",
        "I am gpt-example",
      ].join("\n");
      expect(scrub(text, ids)).toBe(text);
    });

    test("REQ-11: ignores blockquote lines, Markdown links, straight and curly double-quoted text, and multi-token inline code spans", () => {
      const blockquotes = "> I am gpt-example\n  > Written by gpt-example";
      expect(scrub(blockquotes, ids)).toBe(blockquotes);

      const links = "See [I am gpt-example](https://example.com/I-am-gpt-example) for details.";
      expect(scrub(links, ids)).toBe(links);

      const straightQuotes = 'He said "I am gpt-example" to the user.';
      expect(scrub(straightQuotes, ids)).toBe(straightQuotes);

      const curlyQuotes = "She said “I am gpt-example” in the prompt.";
      expect(scrub(curlyQuotes, ids)).toBe(curlyQuotes);

      const inlineCodeMulti = "Run `I am gpt-example` in the shell.";
      expect(scrub(inlineCodeMulti, ids)).toBe(inlineCodeMulti);

      const inlineCodeSingle = "Hello, I am `gpt-example` today.";
      expect(scrub(inlineCodeSingle, ids)).toBe("Hello, I am `[participant]` today.");
    });

    test("REQ-12: preserves trailing spaces, blank lines, and presence or absence of final newline", () => {
      const noFinalNewline = "I am gpt-example   \n\n\nSecond line  ";
      expect(scrub(noFinalNewline, ids)).toBe("I am [participant]   \n\n\nSecond line  ");

      const withFinalNewline = "I am gpt-example\n\n";
      expect(scrub(withFinalNewline, ids)).toBe("I am [participant]\n\n");
    });
  });

  describe("selfIdentifyingLines (REQ-13)", () => {
    test("REQ-13: returns unique lines that scrub would change in first-seen order, excluding fences and blockquotes", () => {
      const ids = ["gpt-example", "kimi-x2"];
      const text = [
        "Normal intro line.",
        "I am gpt-example.",
        "> I am gpt-example.",
        "```",
        "I am kimi-x2.",
        "```",
        "Speaking as kimi-x2, here is my view.",
        "I am gpt-example.",
        "Configured model: gpt-example.",
      ].join("\n");

      expect(selfIdentifyingLines(text, ids)).toEqual([
        "I am gpt-example.",
        "Speaking as kimi-x2, here is my view.",
      ]);
    });
  });

  describe("renderAnswers (REQ-14)", () => {
    test("REQ-14: returns empty string for an empty answers list", () => {
      expect(renderAnswers([], ["gpt-example"])).toBe("");
    });

    test("REQ-14: sorts answers in ascending slot order, scrubs each, and normalizes trailing newlines", () => {
      const answers = [
        { slot: "02", text: "b" },
        { slot: "01", text: "a\n" },
      ];
      expect(renderAnswers(answers, ["gpt-example"])).toBe(
        "### Participant 01\n\na\n\n### Participant 02\n\nb\n"
      );
    });

    test("REQ-14: scrubs self-identifying mentions inside rendered answers", () => {
      const answers = [
        { slot: "02", text: "I am kimi-x2\nDetails" },
        { slot: "01", text: "I am gpt-example." },
      ];
      expect(renderAnswers(answers, ["gpt-example", "kimi-x2"])).toBe(
        "### Participant 01\n\nI am [participant].\n\n### Participant 02\n\nI am [participant]\nDetails\n"
      );
    });
  });
});
