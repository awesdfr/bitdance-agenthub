# Custom Models and Fine-Tunes

Custom models let advanced users register their own fine-tuned or locally hosted models and make them selectable by Agents through the model control plane.

## Sources

| Source | Required field |
| --- | --- |
| `openai_finetune` | `modelId` |
| `huggingface` | `repoId` |
| `local_gguf` | `path` |
| `ollama_custom` | `modelName` |

## Fine-Tune Metadata

Fine-tune metadata records:

- base model
- dataset description
- task specializations
- fine-tuned timestamp
- optional performance delta

This metadata is informational and auditable. Live provider upload or training is never triggered automatically.

## Usage Constraints

Every custom model declares:

- `maxContextWindow`
- whether a special prompt format is required
- known limitations
- compatible Skills
- incompatible Skills

Before assigning a model to an Agent, the system can evaluate requested context length and selected Skills against these constraints.

## Dataset Exports

The system can collect successful Agent experience into a fine-tune dataset export manifest. Exports store source scope, source IDs, purpose, record count, destination provider, and consent status.

Private-data exports remain `pending` unless explicit approval is recorded. The default export mode is manifest-only, so no provider receives data from this API by accident.
