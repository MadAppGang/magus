# How skills get found

A skill being installed does not mean it gets used. There are three different ways one can
reach the model, and which one applies changes what you have to do.

## The list Claude reads every turn

Claude Code pastes a list of the skills you have — each one's name and description — into
the model's context **on every single turn**. That list is how Claude knows a skill exists
without you mentioning it.

The list has a size limit. **The limit is shared across every plugin you have installed**,
not budgeted per plugin. One plugin with fifty chatty descriptions takes room from every
other plugin you have.

So a skill author has a choice to make, and it is a real trade-off rather than an on/off
switch.

## The three ways in

| | How it is reached | You do | Costs list space |
|---|---|---|---|
| **●** | It is in the per-turn list | nothing — Claude picks it | yes |
| **○** | You type its name | `/plugin:skill` | no |
| **▸** | A command pulls it in | run the command | no |

**●** is the default. The skill advertises itself, and Claude decides when it applies.

**○** is for skills you already know you want. A configuration reference is the clearest
case: you look it up when you are configuring something, and Claude has no business guessing
that from "fix the login bug". Advertising it every turn would spend shared budget to tell
Claude about something it should not choose on its own.

**▸** is a library. It exists to be loaded by one specific command, which names it. You
never invoke it, and it is not missing from the list by accident.

None of these means disabled. All three run the same way once reached.

## Being listed is not a guarantee

This is the part that surprises people.

When the total list exceeds the budget, Claude Code does not error and does not drop skills.
It **shortens descriptions** to fit.

The matcher can only match on the text that survived. So a listed skill whose description
got trimmed can quietly stop being found — same skill, same install, different behaviour,
because someone added a plugin.

Two things follow:

- **A short, specific description is not politeness. It is what keeps the skill working.**
  A description that says what the skill does and when to use it, in 200 characters, survives
  trimming that a 400-character one does not.
- **The budget scales with the model's context window.** The same set of skills can fit on a
  large-context model and overflow on a smaller one. A plugin cannot know which you use.

## Seeing where you stand

```
/setup:index-skills
```

It walks every skill reachable from your project — all plugins, all marketplaces, plus your
own — and reports what each costs you per turn, and how many descriptions actually survive.
Run it when a skill has stopped firing for no obvious reason.

That is usually the answer. The skill did not break; it stopped fitting.

## The failure case

A skill can be marked both "not in the list" and "not typeable", and then be named by no
command at all. Nothing can reach it. It is installed, it is documented, and it is dead
weight.

`/setup:index-skills` flags these. If a plugin page ever shows one, that is a packaging bug
in the plugin, not something you can configure around.
