# Artifact Semantic Diff

Section 208 adds semantic artifact comparison. It is designed for PR-review style UI, but it explains what changed instead of only showing raw line diffs.

## API

- `POST /api/artifact-semantic-diffs`
- `GET /api/artifact-semantic-diffs?artifactId=...`

The compare API accepts:

```json
{
  "artifactV1Id": "art_old",
  "artifactV2Id": "art_new"
}
```

## Output

The persisted diff includes:

- structural changes: added, removed, modified, moved
- semantic changes: description, impact, related sections
- summary
- risks

## Supported Inputs

The baseline comparator normalizes common artifact types into section maps:

- documents by markdown headings
- web apps by file path
- diagrams by source
- slide decks by slide index
- code-file artifacts by metadata

The v1 implementation uses deterministic heuristics for semantic descriptions. It does not make live model calls while comparing artifacts.
