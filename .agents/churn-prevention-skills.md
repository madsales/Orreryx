# OrreryX — Churn Prevention Skills

> How to identify, engage, and retain users who are at risk of cancelling.

---

## Churn Signal Taxonomy

### High-Risk Signals
- No login in 14+ days (paid user)
- Payment failure (dunning state)
- Cancel page visited (intent signal)
- Support ticket mentioning "cancel" or "not useful"

### Medium-Risk Signals
- Login frequency dropped 50%+ week-over-week
- No events opened in 7+ days
- Alert emails not opened (2+ in a row)
- Downgrade from Command → Analyst

### Low-Risk (Monitor)
- Only 1 login in first week
- Day-3 email not opened
- No alert setup after 7 days

---

## Retention Email Cadence

Handled by `api/churn-agent.js`:

| Trigger | Subject | Goal |
|---------|---------|------|
| 14 days since signup | `still getting value?` | Re-engage before habit breaks |
| 30 days since signup | `one month in` | Reinforce value, reduce buyer's remorse |
| 60 days since signup | `we miss you` | Win-back with usage reminder |
| Payment fails D+1 | `payment didn't go through` | Soft recovery |
| Payment fails D+4 | `quick reminder` | Urgency |
| Payment fails D+10 | `last chance` | Final: discount or downgrade offer |

---

## D14 Email Strategy

**Tone:** Casual check-in. No pressure. Remind of value.

**Copy direction:**
> "Quick check-in — are you getting what you came for? If the dashboard feels overwhelming or you're not sure where to start, reply and I'll help. If you want to see what's moving markets right now, [open the dashboard →]."

---

## D30 Email Strategy

**Tone:** Milestone. Celebrate staying. Reinforce habit value.

**Copy direction:**
> "One month with OrreryX. Most people who stay past month 1 tell us the same thing: they understand market moves they never understood before. Worth it? We think so."

---

## D60 Email Strategy (Win-back)

**Tone:** Direct, honest. Acknowledge they've drifted. Give a reason to return.

**Copy direction:**
> "It's been a while. A lot has changed in the conflict zones you were tracking — Iran, Taiwan, India-Pakistan are all live right now. Come back and see what you've missed. [Open dashboard →]"

---

## Dunning Recovery

Payment failure sequence (handled by `api/churn-agent.js`):

1. **D+1:** Friendly, no pressure. "Just a heads up — payment didn't go through. Update your card to keep access."
2. **D+4:** More urgent. "Your access pauses in X days if payment isn't resolved."
3. **D+10:** Final. Three options: pay now, accept COMEBACK20 discount, or downgrade to Starter free.

**Never:** Immediately terminate access. Give at least 10 days.
**Always:** Include direct payment update link.

---

## Cancel Save Offers

When a user visits the cancel page or clicks cancel in PayPal, offer (in order):

1. **Pause (30 days free):** "Take a break — your account stays active. Resume anytime."
2. **Discount (COMEBACK20):** "20% off your next 3 months if you stay."
3. **Downgrade to Starter:** "Drop to $0.99/month and keep your account."

**Trigger:** `api/churn-agent.js?action=save-offer` endpoint

**Psychology:** Order matters. Pause first (removes urgency). Discount second (price objection). Downgrade third (last resort before full cancel).

---

## What NOT to Do in Retention

- **Don't guilt-trip:** "You're breaking our hearts" = annoying
- **Don't add friction to cancel:** Dark patterns destroy trust and invite chargebacks
- **Don't spam:** Max 1 retention email per 2 weeks to non-engaged users
- **Don't promise what you can't deliver:** "We've added X since you left" only if true

---

## Churn by Reason (and Responses)

| Reason | Response |
|--------|----------|
| "Too expensive" | Offer COMEBACK20 or Starter downgrade |
| "Not using it enough" | Offer pause; remind of value |
| "Not enough value" | Understand what they wanted; flag for product team |
| "Found an alternative" | Ask what — competitive intelligence |
| "Technical issues" | Escalate + fix fast; offer credit |

---

## Churn Rate Targets

- Monthly churn target: <5% (Analyst tier)
- Dunning recovery rate target: >40%
- Save offer acceptance rate target: >20%
