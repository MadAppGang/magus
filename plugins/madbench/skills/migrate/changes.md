## v0.46.0

A Check's own keys sit beside `type:`. `args:` is no key of any Check type: written under a Check, it fails when the Check is built (at `preflight` and on every run) as `unknown key "args"`, followed by the keys that type takes.

- A Check's `args: {<key>: <value>, …}` → each `<key>: <value>` beside `type:`, and delete `args:`. `- {type: exec, args: {cmd: [go, test]}}` → `- {type: exec, cmd: [go, test]}`.
- `session:match`'s `args.type` → `event_type`.
- `session:tool-args-match`'s `args.args` → `tool_args`.
- A script reading report JSON: a Check's `spec.args.<key>` → `spec.<key>`. The program behind a `custom:*`, `ts`, `js` or `python` Check is unchanged: it still reads the Check's own keys from the envelope as `assertion.args.<key>`.
- `exec`'s `cmd:` takes a string, run as `sh -c '<line>'`; a list is still the exact argv. `exec`'s `value: <command>` → `cmd: <command>`: `exec` takes no `value:`, and one written there fails when the Check is built. The text runs under a shell now, so a `*` or `?` in it expands as it does in a terminal; quote it (`-name '*.go'`) to keep it literal. `cmd: [sh, -c, '<line>']` still works; `cmd: <line>` is the same command.
- `sandbox.provision.steps`: each step reads the same way, a string run by `sh -c` or a list that is the exact argv. `- [sh, -c, 'npm ci']` → `- npm ci`.
- A stored report written before v0.46.0 records its Checks with `args:`. `madbench grade` reports each such Check as could not be re-graded (`unknown key "args"`). Re-run the bench to get a report `grade` can replay.

## v0.45.0

Nothing a v0.44 file spells changed. The guard's verdict word did.

- A script or CI step matching `CONFOUNDED` in madbench's output → match `FORBIDDEN CHANGES`. The guard section's per-variant verdict reads `ALLOWED`, `UNGUARDED` or `FORBIDDEN CHANGES`.

## v0.44.0

`harness.config.edits` replaces one marked block of a file in the tree `harness.config.dirs` composes. Nothing a v0.43 file spells changed; the line below is optional and removes a staging script.

- A `harness.config.dirs` entry naming a directory a script assembled from a base, whole variant files and a marked-block replacement (`dirs: [./envs/{{variant}}]`) → `dirs: [./base, ./variants/{{variant}}]` plus `edits: [{file: <path inside the tree>, between: [<START line>, <END line>], with: <fragment beside the bench>}]`. Move each fragment out of `variants/` (everything there is copied into the tree), and in `guard_changes.allow` replace `harness/config/files/<file>` with `harness/config/regions/<file>/<START line, trimmed>`. Delete the script.

## v0.42.0

The file that compares setups is an Experiment, each setup in it a named variant, and running a bench several times gives trials. An old key, flag or file name fails like a typo and names nothing.

- A file with `bench:` and `runs:` (named `*.eval.yaml`) → an Experiment: rename the file to `*.experiment.yaml`, and `runs:` → `variants:`. Each entry keeps `name:` and `params:`.
- A `runs:` entry with no `name:` → give it one. Every variant is named, and names are unique.
- `guard_changes.baseline: <name>` → delete the key, and make `<name>` the FIRST entry of `variants:`. The first declared variant is the baseline. With no `baseline:`, the first entry already was.
- `--run <name>` → `--variant <name>`, on `madbench`, `madbench list`, `madbench check` and `madbench report`.
- `--repeat N` → `--trials N`.
- `experiment: "<why the premise is not established>"` on a bench → `unproven: "<the same text>"`, and the bench moves from `experiments/` to `unproven/`.
- A script reading report JSON. Every field v0.42.0 renamed:
  - `--trials` JSON: `runs[]` → `trials[]`, `aggregate.runCount` → `aggregate.trialCount`, `aggregate.chosenPass` → `aggregate.chosenTrial`; `aggregate.perTest` is gone, read `aggregate.perScenario`.
  - A stored report's envelope: `repeats` → `trials`, `meta.repeat` → `meta.trial_count`, `meta.eval_path` → `meta.experiment_path`; the same `eval_path` → `experiment_path` in `index.jsonl`.
  - A metric's spread across trials: `passes` → `trials`.
  - `guard_changes` is a list with one entry per Experiment (each naming its `experiment_path`); in each entry `runs` → `variants`, and in each of those, and in each changed input, `run` → `variant`.
  - A bench's `experiment` → `unproven`.
- A stored report or store written before v0.42.0 (report schema below 3, store schema below 2) is not read: re-run the bench (Step 6).

The Harness is one `harness:` block. Every key under it is the Harness's own, and an unknown one fails naming its full path (`harness.config.dir: unknown key`).

- `harness: <type>` plus `harness_config: {…}` → `harness: {type: <type>, …}`, the keys of `harness_config:` moved into the block as the lines below say. A bench with no `harness_config:` keeps `harness: <type>`.
- `harness_config.binary` → `harness.binary`; the same for `magmux_binary`, `model`, `provider`, `effort`, `use_subscription` and `args`.
- `harness_config.system_prompt` → `harness.config.system_prompt`.
- `harness_config.agent_env: <dir>` → `harness.config.dirs: [<dir>]`. More than one entry composes in order, a later file replacing an earlier one; an entry of `""` is skipped.
- `harness_config.plugins` with `harness_config.marketplace` → `harness.config.plugins: [<plugin folder>, …]`: each entry is the path to the plugin folder (the directory holding `plugin.json`). A bare name `<plugin>` becomes the folder that marketplace's `.claude-plugin/marketplace.json` names as its `source`; `{id, path, marketplace}` becomes its `path`. Drop `marketplace:` and `id:`: the identity is derived.
- `harness_config.environment: {probe, details, require}` → `harness.probe: {enabled, details, require}`.
- `harness: mock` keeps only `type` and `model`; `harness: demo` only `type`. Delete any other key on such a bench.
- `guard_changes.allow`: `effort` → `harness/effort`; `system_prompt` → `harness/config/system_prompt`; `args`, `args/<i>` → `harness/args`, `harness/args/<i>`; `plugins`, `plugins/<id>/…` → `harness/config/plugins`, `harness/config/plugins/<id>/…`; a path inside an `agent_env` tree → `harness/config/files/<path>`.
- `guard_changes.allow` of an Experiment whose variants differ by model → add `harness/model` (and `harness/provider` when the provider differs). The model is audited now, and an undeclared model difference is FORBIDDEN CHANGES.
