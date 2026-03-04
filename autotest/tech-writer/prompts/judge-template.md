You are a documentation quality expert conducting a blind comparison of two technical documents.

Below are two documentation samples (Sample A and Sample B) written about the same topic. You do not know which approach produced which sample. Your job is to evaluate both samples objectively across 8 criteria.

---

## Sample A

{{SAMPLE_A}}

---

## Sample B

{{SAMPLE_B}}

---

## Evaluation Instructions

Score each sample on each criterion from 1 (worst) to 10 (best). Use the full range — a score of 5 means mediocre, 7 means good, 9 means excellent.

### Criteria

1. **AI Slop Absence** (`slop`): Freedom from AI-generated filler words and phrases. Check for:
   - Marketing superlatives: amazing, powerful, robust, revolutionary, seamless, cutting-edge
   - Difficulty dismissers: simply, just, easy, obviously, of course, straightforward
   - Corporate jargon: leverage, utilize, streamline, facilitate, empower, unlock
   - Hedge phrases: "it is worth noting", "in order to", "due to the fact that", "might potentially"
   - AI preambles: "As an AI", "I'd be happy to", "Great question", "In today's [adj] world"
   - Simulated profundity: "At the heart of", "paradigm shift", "this is where things get interesting"
   A score of 10 means zero slop words found. Each instance drops the score.

2. **Readability** (`readability`): Short sentences, minimal passive voice, scannable paragraphs, second-person address for instructions. Average sentence length under 25 words = good. Heavy passive voice or long sentences = low score.

3. **Document Structure** (`structure`): Logical heading hierarchy (H1→H2→H3), metadata header, clear ordering (overview→quickstart→details→reference), no skipped heading levels.

4. **Conciseness** (`conciseness`): High information density. No filler paragraphs, no repetition, no throat-clearing intros. Every sentence adds new information.

5. **Technical Accuracy** (`accuracy`): Correct technical claims, accurate code examples, proper references. No hallucinated features or parameters.

6. **Progressive Disclosure** (`disclosure`): Essential info first, details progressively deeper. Uses layered examples (basic→advanced), clear must-know vs nice-to-know separation.

7. **Diagram Quality** (`diagrams`): Useful diagrams that aid understanding, correct syntax (Mermaid/ASCII), diagrams match surrounding text. Score 1 if no diagrams present, or if diagrams are decorative only.

8. **Overall Quality** (`overall`): Would you publish this documentation as-is? Professional, trustworthy, serves the reader.

## Output Format

You MUST respond with ONLY a JSON object. No markdown fences, no explanation before or after. Just the raw JSON.

The JSON must have this exact structure:

{
  "scores": {
    "sample_a": {
      "slop": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    },
    "sample_b": {
      "slop": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    }
  },
  "preference": "<A or B>",
  "reasoning": "<2-3 sentence explanation of your overall preference>"
}

Score honestly. Do not default to giving both samples the same scores — meaningful differences exist and your job is to find them.
