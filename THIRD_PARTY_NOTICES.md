# Third Party Notices

This project studies and adapts architecture and UX patterns from MIT-licensed
open source projects. The current implementation is written in this repository,
with the following projects used as references for desktop agent orchestration,
local runtime, skills, CLI-first tooling, and lightweight workbench interaction.

## OpenClaw

- Source: https://github.com/openclaw/openclaw
- License: MIT
- Copyright: OpenClaw Foundation
- Used for reference: package organization, agent/tool/runtime separation, and
  local-first agent orchestration patterns.

## Hermes Agent

- Source: https://github.com/NousResearch/hermes-agent
- License: MIT
- Copyright: Nous Research
- Used for reference: narrow core philosophy, command/skill-first extension,
  JSON-RPC backend/catalog ideas, and desktop agent runtime boundaries.

## Hermes Agent Desktop

- Source: https://github.com/Felix-Forever/hermes-agent-desktop
- License: MIT
- Copyright: Felix-Forever
- Used for reference: simple desktop workbench layout, local bridge concept,
  and single-window agent conversation flow.

## License Note

The referenced projects keep their original licenses and copyright notices.
When code is directly ported in the future, the copied file or module should
carry the relevant copyright header and license attribution.
