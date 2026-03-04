Write technical documentation about how skill injection works in the dev plugin's `/dev:implement` command.

The documentation should cover:

1. What skills are and how they're discovered (SKILL.md files, frontmatter parsing)
2. How the Skill tool invocation works — what happens when a skill is loaded
3. How content gets injected into the conversation context
4. How `/dev:implement` chains multiple skills (brainstorming → planning → execution)
5. The lifecycle of a skill invocation from trigger to completion

The target audience is a Claude Code plugin developer who wants to understand the skill system to build their own skills.

Include:
- Code examples showing skill file structure
- Diagrams illustrating the injection flow
- A quick-start section for creating a basic skill
- Reference information for the SKILL.md frontmatter schema

---

## MANDATORY WRITING RULES

You MUST follow these rules exactly. Violations disqualify the document.

### Rule 1: Banned Words and Phrases (77-Entry Anti-Slop Registry)

NEVER use any of these words or phrases. Each one is banned for a specific reason.

**CRITICAL — instant disqualifier (AI generation artifacts):**
- "As an AI", "As a language model", "I'd be happy to", "Certainly!", "Absolutely!", "Great question!", "I hope this helps", "Feel free to ask", "Let me explain", "Allow me to clarify"
- "In today's [anything] world", "In an increasingly [adj]", "In the realm of", "At the heart of", "The weight of [X]"

**HIGH — marketing superlatives and difficulty dismissers:**
- amazing, revolutionary, powerful, robust, seamlessly, effortlessly, incredible, world-class, cutting-edge, state-of-the-art, next-generation, innovative, game-changing, industry-leading, best-in-class
- simply, easy, just, obviously, of course, clearly, trivially, straightforward, quick

**MEDIUM — corporate jargon and filler:**
- leverage, utilize, streamline, facilitate, empower, unlock, accelerate, transform, drive (metaphorical), deliver value, synergy/synergize, actioning, comprehensive (unless you enumerate what it covers)
- "it is worth noting that", "it is important to note", "please note that", "as mentioned above", "as stated earlier", "due to the fact that" (use "because"), "in the event that" (use "if"), "in order to" (use "to"), "might potentially", "could potentially", "may or may not"

**LOW — minor filler:**
- "at this point in time" (use "now"), "at the present time"

### Rule 2: Active Voice

Write in active voice. Target: <10% passive voice sentences.
- BAD: "The skill is loaded by the system"
- GOOD: "The system loads the skill"
- BAD: "Configuration can be specified in the frontmatter"
- GOOD: "Specify configuration in the frontmatter"

Use imperative mood for instructions:
- BAD: "You should run the command"
- GOOD: "Run the command"

### Rule 3: Sentence Length

Keep average sentence length under 20 words. Maximum single sentence: 35 words.
Break long sentences into two. Use periods, not semicolons.

### Rule 4: Document Structure (Diátaxis Framework)

Organize content using the Diátaxis documentation framework:
1. **Tutorial** (learning-oriented): Quick-start walkthrough for creating a skill
2. **How-to** (task-oriented): Step-by-step procedures for specific tasks
3. **Reference** (information-oriented): Frontmatter schema, API details, configuration options
4. **Explanation** (understanding-oriented): Architecture decisions, design rationale

Start with a metadata header:
```
# Title
> One-sentence description of what this document covers.
> **Audience**: [who this is for]
> **Prerequisites**: [what reader needs to know]
```

### Rule 5: Progressive Disclosure

Lead with essentials. Layer details progressively:
1. One-paragraph overview (what + why)
2. Quick-start example (30-second version)
3. Detailed walkthrough
4. Reference tables
5. Edge cases and advanced usage

Use collapsible sections (`<details>`) for advanced content that most readers skip.

### Rule 6: Conciseness

Every sentence must add new information. Delete:
- Introductory throat-clearing ("In this section, we will discuss...")
- Repetition of the same point in different words
- Filler paragraphs that summarize what's coming next
- Conclusions that repeat what was already said

### Rule 7: Diagrams

Include at least one Mermaid diagram showing the skill injection flow.
Diagrams must:
- Use correct Mermaid syntax (test it mentally)
- Match the text they accompany
- Add information that prose alone cannot convey (flow, timing, relationships)
- Have descriptive labels (not "Step 1", "Step 2")

### Rule 8: Code Examples

Every code example must:
- Be complete enough to copy-paste and use
- Show expected output or behavior in a comment
- Use realistic values (not "foo", "bar", "example")
