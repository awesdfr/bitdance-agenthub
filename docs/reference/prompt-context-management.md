# Prompt And Context Management

Section 31 turns Prompt handling into a managed control-plane capability instead of a
single free-form string.

## Prompt Templates

Prompt templates now persist:

- engine: `handlebars`, `jinja2`, or `custom`
- template content
- variable bindings from Agent profile, task input, memory, runtime state, env, or static text
- conditional blocks
- Prompt version content
- Prompt version A/B experiment metadata

The render API resolves variables, includes matching conditional blocks, reports missing
variables, returns A/B metadata, and estimates rendered prompt tokens.

## Context Compression

Context compressor policies define:

- trigger threshold, usually `0.8`
- strategy: `summarize_oldest`, `summarize_least_relevant`, `sliding_window`, or `hierarchical`
- always-preserved context: plan, current goal, error log, user instructions, and important observations
- summarizer model class: `cheap_local` or `same_model`

Compression plans persist the model-call decision: token estimate, token budget, threshold,
preserved sections, compressed sections, omitted-section records, allocation, and a summary.

## Token Budget Allocation

The default allocation matches the implementation plan:

- system prompt: 3k
- current plan: 2k
- relevant memories: 3k
- recent step summaries: 5k
- tool definitions: 2k
- safety margin: 2k
- full recent steps: remaining window budget, defaulting to the last 3 steps

This keeps long employee-Agent tasks from silently overflowing the model context window.
