# Agent Persona

Section 43 makes persona part of the Agent Profile instead of treating it as a decorative label.

## Stored Fields

`agent_profiles.persona` stores:

- `avatar`
- `tone`: `formal`, `casual`, `technical`, `friendly`, `concise`, or `detailed`
- `language`
- `communicationStyle.useEmoji`
- `communicationStyle.useCodeBlocks`
- `communicationStyle.preferBulletPoints`
- `communicationStyle.showThinkingProcess`
- `communicationStyle.selfReference`
- `personalityTraits.cautious`
- `personalityTraits.creative`
- `personalityTraits.thorough`
- `personalityTraits.efficient`

Trait values are clamped to `0..1` by the control-plane service.

## Runtime Effect

Persona is included in:

- Agent Profile API create/patch payloads
- Agent Factory creation UI
- employee-run phase events
- deterministic `personaDecisionStyle`
- runtime context snapshots
- prompt/context packing sections

This lets the runtime distinguish a careful reviewer, a concise operator, a creative designer, and a detailed analyst without hard-coding separate Agent classes.
