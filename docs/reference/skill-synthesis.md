# Skill Synthesis and Tool Pipelines

Skill synthesis discovers when two or more Skills can be composed into a reusable capability. Tool pipelines make that composition executable by mapping one tool step's output into the next step's input.

## Discovery

The discovery record stores:

- source Skill IDs
- detected complementary pattern
- suggested composite Skill name
- confidence score
- publishable flag
- status

Examples:

- `excel-reader` + `chart-generator` -> data analysis composite
- `web-scraper` + `pdf-generator` -> web-to-PDF composite

## Tool Pipeline

Each pipeline stores:

- `chain`: ordered tool invocation descriptors
- `inputOutputMapping`: how previous outputs feed later inputs
- `onStepFailure`: `abort`, `skip`, `retry`, or `use_fallback_tool`
- `composedOf`: dependency Skill IDs
- `publishable`: whether it can become a reusable composite Skill

Publishing a pipeline marks it as `published` and promotes its synthesis record to `published`.
