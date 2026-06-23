# Multi-Model And Agent Consensus

Section 119 says important decisions should not rely on one model.

The implementation adds record-only consensus controls:

- `dual_model_verifications`
- `agent_consensus_votes`
- `adversarial_reviews`

## Dual Model Verification

`POST /api/consensus/dual-model-verifications` records independent primary and secondary results for critical work:

- security analysis
- code review
- data analysis conclusions
- financial calculations
- legal document generation

The verifier compares the JSON outputs, records disagreement points, calculates a confidence score, and recommends:

- use primary
- use secondary
- merge
- ask user

The secondary model strategy can be:

- cheap fast model
- same model
- different provider

## Agent Voting

`POST /api/consensus/agent-votes` records a quorum-based vote among Agents.

Each voter includes:

- Agent id
- vote
- reasoning
- confidence

The vote records quorum, required majority, tie breaker, winning vote, majority ratio, and decision.

## Adversarial Review

`POST /api/consensus/adversarial-reviews` records a red-team style review.

The reviewer looks for:

- assumptions
- missing edge cases
- attacker exploitation paths
- worst-case failure modes

The result is stored as passed, issues found, or needs revision.

## API

- `GET /api/consensus/dual-model-verifications`
- `POST /api/consensus/dual-model-verifications`
- `GET /api/consensus/agent-votes`
- `POST /api/consensus/agent-votes`
- `GET /api/consensus/adversarial-reviews`
- `POST /api/consensus/adversarial-reviews`

v1 does not call live model providers from this layer. It stores and evaluates independently produced results so workflow nodes, approvals, and run monitors can make safer decisions.
