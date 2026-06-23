# Task Templates

Section 191 adds a reusable task template library. A template defines parameter fields, recommended Agent role, an optional workflow, description and input templates, estimates, tags, related memories, required Skills, sample output references, and usage statistics.

## API Surface

- `POST /api/task-templates/seed` installs the default template library.
- `GET /api/task-templates` lists templates by category, status, or query.
- `POST /api/task-templates` creates a template.
- `POST /api/task-templates/:id/instantiate` validates parameters and creates a rendered task-template run.
- `GET /api/task-template-runs` lists rendered template runs.
- `POST /api/task-template-runs/:id/complete` records success, duration, cost, and updates template statistics.

## Parameter Types

Templates support `string`, `number`, `boolean`, `file`, `url`, and `select`. Required parameters must be present; URL parameters are parsed before rendering; select values must match configured options.

## Rendering

`descriptionTemplate` and string values inside `inputTemplate` support `{{param}}` placeholders. Instantiation stores both the submitted parameter values and rendered output so a run is auditable and repeatable.

## Default Templates

The seed library includes PR Review, Bug Fix, Feature Development, Data Report, Meeting Notes, Competitor Research, Code Refactor, Dependency Upgrade, File Organizer, and Email Handling.
