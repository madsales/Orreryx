# OrreryX — Analytics Skills

> What to measure, how to track it, and how to act on the data.

---

## North Star Metric

**Weekly Active Paying Users (WAPU)**
— Users on a paid plan who logged in at least once in the last 7 days.

Everything else serves this number.

---

## Funnel Metrics (Track Weekly)

| Stage | Metric | Target |
|-------|--------|--------|
| Awareness | Unique visitors / week | Grow 10% MoM |
| Acquisition | Trial signups / week | Grow 10% MoM |
| Activation | Magic link open rate | >70% |
| Activation | Day-1 login rate | >60% |
| Retention | Day-7 return rate | >40% |
| Revenue | Trial → paid conversion | >15% |
| Revenue | MRR | Track absolute + growth rate |
| Retention | Monthly churn rate | <5% |
| Expansion | Starter → Analyst upgrades | Track |

---

## Key Events to Track (Product Analytics)

Essential events per session:
- `signup` — email submitted, magic link sent
- `login` — magic link clicked, session started
- `event_viewed` — user opened a geopolitical event
- `map_opened` — interactive risk map opened
- `alert_enabled` — email alert set up
- `upgrade_initiated` — user clicked upgrade CTA
- `payment_completed` — successful subscription
- `cancellation` — subscription cancelled

---

## Redis-Based Analytics (Current Architecture)

Until a proper analytics platform is added, use Redis counters:

```
analytics:signups:{YYYY-MM-DD}     → daily signup count
analytics:logins:{YYYY-MM-DD}      → daily login count
analytics:events_viewed:{YYYY-MM}  → monthly event views
analytics:upgrades:{YYYY-MM}       → monthly upgrades
analytics:mrr:{YYYY-MM}            → monthly recurring revenue
```

Admin dashboard (`/api/admin`) should read these and display trends.

---

## Email Analytics (Resend)

Track per campaign:
- Open rate (target: >35% for nurture, >20% for cold)
- Click rate (target: >5%)
- Unsubscribe rate (flag if >0.5%)
- Bounce rate (flag if >2%)

---

## A/B Test Analytics

See `ab-testing-skills.md` for full methodology.

Quick reference:
- Minimum sample: 100 per variant before drawing conclusions
- Significance threshold: p < 0.05 (two-proportion z-test)
- Test one variable at a time

---

## Weekly Analytics Review Checklist

Run every Monday:
- [ ] New trial signups (vs. prior week)
- [ ] Magic link open rate
- [ ] Day-7 retention rate
- [ ] Trial → paid conversion rate
- [ ] MRR change
- [ ] Churn events
- [ ] Any A/B test results ready for decision
- [ ] Top-performing social post of the week
- [ ] Email open rates for automated sequences

---

## Revenue Analytics

**MRR calculation:**
```
MRR = (Starter users × $0.99) + (Analyst users × $14.99) + (Command users × $34.99)
```

**Churn impact:**
```
Net MRR change = New MRR - Churned MRR - Downgraded MRR + Upgraded MRR
```

**LTV estimate:**
```
LTV = ARPU / Monthly Churn Rate
```

At 5% churn:
- Analyst LTV = $14.99 / 0.05 = ~$300
- Command LTV = $34.99 / 0.05 = ~$700

---

## Cohort Analysis (Monthly)

Group users by signup month and track:
- What % are still active at Month 1, 2, 3, 6?
- What % upgraded to paid?
- What plan did most users end up on?

This reveals whether product improvements are actually improving retention.

---

## Signals to Act On Immediately

- Trial → paid rate drops below 10% for 2+ weeks → investigate onboarding
- Day-1 magic link open rate drops below 60% → check email deliverability
- Churn rate spikes above 8% → check for product bugs or competitive event
- Signup rate drops 30%+ week-over-week → check acquisition channels
