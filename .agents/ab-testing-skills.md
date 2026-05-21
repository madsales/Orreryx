# OrreryX — A/B Testing Skills

> How to design, run, and interpret A/B tests for OrreryX.

---

## Testing Infrastructure

Handled by `api/ab-agent.js`.

### Endpoints
- `POST /api/ab-agent?action=create` — create experiment
- `GET /api/ab-agent?action=assign&expName=X&userId=Y` — get variant for user
- `POST /api/ab-agent?action=convert` — record conversion
- `POST /api/ab-agent?action=impression` — record impression
- `GET /api/ab-agent?action=results&expName=X` — get stats
- `GET /api/ab-agent?action=list` — list all experiments

### Redis Schema
```
ab:exp:{name}              → experiment definition + status
ab:assign:{name}:{userId}  → variant assigned to user
ab:results:{name}          → hash: {variant}:impressions, {variant}:conversions
ab:experiments             → SET of all experiment names
```

---

## Experiment Design Rules

### 1. One Variable at a Time
Never change headline AND button color AND copy simultaneously.
You won't know what caused the difference.

### 2. ICE Prioritization
Before running, score each test idea:
```
ICE = (Impact × Confidence × Ease) / 100
```
- **Impact (1–10):** How much will this move the metric if it wins?
- **Confidence (1–10):** How sure are you this will improve things?
- **Ease (1–10):** How easy is this to implement?

Run highest ICE score first.

### 3. Statistical Significance
- Minimum 100 impressions per variant before looking at results
- Use two-proportion z-test (implemented in ab-agent.js)
- Significance threshold: p < 0.05 (95% confidence)
- Never call a winner before significance is reached

### 4. Minimum Test Duration
- Minimum 7 days (captures day-of-week variation)
- Maximum 30 days (diminishing returns, market context changes)

---

## Test Priority Queue

Highest-impact tests for OrreryX (run in this order):

| # | Test | Metric | Hypothesis |
|---|------|--------|-----------|
| 1 | Hero headline variants | Visit → signup rate | More specific headline → more signups |
| 2 | CTA button text | Visit → signup rate | "Try Free" vs. "Start Free Trial" vs. "Get Access" |
| 3 | Email subject line | Open rate | 2-word vs. 4-word vs. question format |
| 4 | Day-7 email body | Click rate | Value-led vs. feature-led |
| 5 | Pricing page tier highlight | Trial → paid | "Most Popular" vs. "Best Value" vs. no badge |
| 6 | Trial CTA placement | Signup rate | Above fold only vs. multiple placements |
| 7 | Onboarding first screen | Day-3 retention | Event-first vs. feature tour |

---

## Variant Assignment (Deterministic)

The ab-agent uses deterministic hashing so the same user always gets the same variant:
```javascript
Math.abs(hash(`${userId}:${expName}`)) % variantCount
```
This prevents showing a user different variants on different sessions.

---

## Reading Results

ab-agent.js generates weekly reports (emailed to admin) showing:
- Impressions per variant
- Conversion rate per variant
- Absolute difference
- Statistical significance (p-value)
- Winner declaration (if p < 0.05)

### Interpreting Results
- **p < 0.05:** Statistically significant — declare winner, ship winning variant
- **0.05 < p < 0.20:** Trending — run longer to get significance
- **p > 0.20:** No signal — stop and try a different test

### Effect Size to Care About
For OrreryX:
- Email open rate: care about 3%+ absolute difference (e.g. 32% → 35%)
- Homepage conversion: care about 0.5%+ absolute difference
- Trial → paid rate: care about 2%+ absolute difference

---

## What NOT to Test

- Changes you're not prepared to ship (even if it wins, you won't use it)
- Misleading or deceptive copy (even if it converts better)
- Features not yet built (test demand, but don't lie)
- Sample sizes < 50 per variant (meaningless data)

---

## After a Test Concludes

1. Ship the winning variant to 100% of users
2. Record the result in `ab:exp:{name}` (status: "completed", winner: "control"|"variant")
3. Archive the test in the weekly report
4. Identify next test in the priority queue
5. Document learnings: what worked, what didn't, why (in Redis or a doc)
