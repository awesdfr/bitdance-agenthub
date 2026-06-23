# Help Center

The in-product help center turns Section 48 into a structured control plane instead of loose copy.

## Records

- `help_center_surfaces` registers every configuration or monitoring page that needs a visible help affordance.
- `help_center_items` stores the page-level `?` button, hover tooltips, example values, and error-message documentation links.
- `help_onboarding_flows` stores guided flows such as the first-Agent success path.

## Default Surfaces

The seed registers these active surfaces:

- Agent Factory
- Model Control
- Tool Control
- Skills Center
- Agent Canvas
- Memory Center
- Governance Center
- Observability Center
- ConfigOps Center
- Task Scheduler

Every default surface has four help items:

- A `question_button` item with `?` as the default page affordance.
- A `tooltip` item for hover-level context.
- An `example_value` item that gives a valid field example.
- An `error_doc_link` item that points to `docs/troubleshooting/common-issues.md`.

## Onboarding

The built-in `first_agent_success_path` flow guides a new user through:

1. Create the first Agent.
2. Run the first task.
3. Inspect the first artifact.

These steps map to `agent_factory` and `observability_center` so the UI can highlight the current page, show the right help content, and let the user resume the flow.

## API

- `POST /api/help-center/seed`
- `GET /api/help-center/surfaces`
- `POST /api/help-center/surfaces`
- `GET /api/help-center/items`
- `POST /api/help-center/items`
- `GET /api/help-center/onboarding-flows`
- `POST /api/help-center/onboarding-flows`

The frontend helpers in `src/lib/api.ts` wrap these endpoints as `seedHelpCenter`, `fetchHelpCenterSurfaces`, `createHelpCenterSurface`, `fetchHelpCenterItems`, `createHelpCenterItem`, `fetchHelpOnboardingFlows`, and `createHelpOnboardingFlow`.

## UI Contract

Each configuration page should load its `help_center_surface` by `surfaceKey`, render the `questionButtonLabel`, attach `tooltip` items to their selectors, display `example_value` beside fields, and append `error_doc_link` targets to validation errors.
