# Code Analysis Plugin

Read-only codebase investigation. `code_search` is always present; structural tools appear only
when the configured search engine genuinely supports them. The engine is named in project
settings and is swappable.

Run `/code-analysis:help` for the tool surface and `/code-analysis:setup` to see which engine is
active and whether it is healthy.

## Model Configuration

External model selection uses the centralized the live catalog (`list_models`) system.

See `claudish:claudish-usage` skill → "Model Alias Resolution" for the resolution procedure.
