# Agent Certification And Exams

Section 206 adds optional Agent capability certification. It lets a team define repeatable exams, run an Agent through submitted task outputs, and store a scored certification result.

## Exam Definition

An exam contains:

- name and description
- certification level: `basic`, `intermediate`, `advanced`, or `expert`
- validity period: `6m`, `1y`, or `permanent`
- passing score
- tasks with expected output and a scoring rubric

Rubrics use four score dimensions:

- correctness
- efficiency
- codeStyle
- safetyAwareness

## Running An Exam

`POST /api/agent-certification-exams/:id/run` accepts an Agent profile id and task submissions. The scorer produces:

- total score
- pass/fail result
- badge
- expiration timestamp
- per-task scores
- discovered limitations
- improvement suggestions

## Safety Boundary

Certification records do not automatically grant permissions. They are evidence for UI, scheduling, recommendations, or human review. Permission elevation still goes through autonomy, approval, and sandbox policies.
