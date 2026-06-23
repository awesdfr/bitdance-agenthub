# Trust Calibration

Section 121 is implemented as a trust-calibration control loop for employee Agents.

The goal is to prevent both blind trust and permanent distrust:

- New or weakly proven Agents stay approval-heavy.
- Reliable Agents can be recommended for higher autonomy.
- Long high-confidence streaks still trigger periodic human review.

## Persistence

Trust calibration uses:

- `trust_calibration_policies`
- `trust_calibration_evaluations`

Policies store the visible trust signals:

- High-confidence indicators: confidence badge, evidence, verified check.
- Low-confidence indicators: warning badge, uncertainty reason, human-review suggestion.
- Anti-overtrust rules: success-streak warning and periodic reality check.

Evaluations store:

- days active;
- run count;
- success rate;
- approval approved/rejected counts;
- takeover count;
- modification rate;
- similar task count;
- verified artifact count;
- high-confidence success streak;
- current and recommended trust level;
- current and recommended autonomy level;
- recommendation.

## Trust Path

The default trust path maps to the plan:

- Day 1: `day_1_untrusted` -> `propose_only`
- Day 3: `low` -> `execute_with_approval`
- Day 7: `medium` -> `execute_low_risk`
- Day 30: `high` -> `fully_autonomous` with periodic review

## API Surface

- `POST /api/trust-calibration/policies/seed`
- `GET /api/trust-calibration/policies`
- `POST /api/trust-calibration/policies`
- `POST /api/trust-calibration/evaluate`
- `GET /api/trust-calibration/evaluations`

## Runtime Use

Agent Factory and runtime monitoring can show evaluation signals before changing autonomy. The system should never silently upgrade an Agent only because a score is high; it should present the recommendation, reasons, and anti-overtrust signals for user review.
