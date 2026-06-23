# Agent Template Marketplace

Section 44 is implemented as a local-first Agent template and marketplace control plane.

## Template Types

`agent_template_packages` can represent:

- `agent_profile`
- `workflow`
- `skill_package`
- `software_command`
- `macro_package`

Each package stores a stable `templateKey`, category, name, role, payload, required Skills, recommended tools, tags, author, source, visibility, marketplace URL, status, install count, and optional rating.

## Default Agent Templates

`POST /api/agent-templates/seed` seeds common employee roles:

- Development: frontend, backend, full-stack, DevOps, code review, QA.
- Design: UI, logo, presentation.
- Operations: content operations, data analysis, SEO.
- Office: document writing, email handling, calendar management, meeting notes.
- Project: browser automation, file processing, batch renaming, data crawling.

The default templates install into real Agent Profiles with output contracts, permission hints, behavior rules, and success criteria.

## Marketplace Flow

Users can create and share:

- Agent Profile templates.
- Workflow templates.
- Skill packages.
- Software Command configurations.
- Macro recording packages.

Agent Profile installs create a new `agent_profiles` row. Other template types are installed as auditable records in v1 so the system can expose marketplace flows without mutating unrelated resource graphs automatically.

## API Surface

- `GET/POST /api/agent-templates`
- `POST /api/agent-templates/seed`
- `POST /api/agent-templates/:id/publish`
- `POST /api/agent-templates/:id/install`
- `GET /api/agent-template-installs`

The matching typed frontend helpers live in `src/lib/api.ts`.

## Safety Boundaries

- Installing non-Agent resources is record-only in v1.
- Template variables only replace `{{key}}` placeholders in stored payload text.
- External marketplace URLs are metadata only; no unapproved remote install or code execution is performed.
