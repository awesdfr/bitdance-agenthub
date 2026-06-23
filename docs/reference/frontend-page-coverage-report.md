# Frontend Page Coverage Report

Section 21 requires eight frontend surfaces: Agent factory, model management,
tool connections, software CLI-ization, Skills center, Agent canvas, run
monitoring, and memory/learning.

`GET /api/frontend-pages/coverage-report` verifies that these surfaces are
present in the sidebar and backed by the expected workbench components.

The report checks sidebar import/mode/label/render markers, component file
existence, and component-level capability markers such as run controls, model
tests, tool dry-runs, software commands, marketplace iframe, workflow status,
artifact validation, and memory review controls.

Six surfaces are dedicated workbenches. Software CLI-ization is intentionally
implemented inside Tool Control, and run monitoring is intentionally split
across Agent Factory, Agent Canvas, and Observability.
