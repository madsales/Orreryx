# OrreryX — Revenue Operations (RevOps) Skills

> How to manage, optimize, and scale OrreryX's revenue infrastructure.

---

## Revenue Architecture

**Payment processor:** PayPal (Subscriptions API)
**State store:** Upstash Redis (plan status, subscriber records)
**Email delivery:** Resend (primary), Gmail SMTP (fallback)
**Agent cron:** Vercel cron jobs via vercel.json

---

## Plan Management (Redis Schema)

```
user:{email}:plan          → "starter" | "analyst" | "command" | "free"
user:{email}:sub_id        → PayPal subscription ID
user:{email}:sub_status    → "ACTIVE" | "CANCELLED" | "SUSPENDED"
sub:{email}                → { email, signedUpAt, plan, day3Sent, day7Sent, ... }
```

---

## Subscription Lifecycle

```
Free Trial (3 days) 
  → Trial expires → prompt upgrade
  → OR: Magic link + PayPal subscribe flow → ACTIVE

ACTIVE 
  → PayPal payment → cycle continues
  → Payment fails → SUSPENDED → dunning sequence
  → User cancels → CANCELLED → save-offer flow

SUSPENDED 
  → User updates payment → ACTIVE restored
  → 10 days no payment → downgrade to free

CANCELLED 
  → Re-subscribe → ACTIVE (new subscription ID)
  → Win-back emails (D60) → re-activation
```

---

## PayPal Plan IDs (from api/paypal.js)

| Tier | Price | PayPal Plan Env Var |
|------|-------|---------------------|
| Starter | $0.99/mo | `PAYPAL_STARTER_PLAN_ID` |
| Analyst | $14.99/mo | `PAYPAL_ANALYST_PLAN_ID` |
| Command | $34.99/mo | `PAYPAL_COMMAND_PLAN_ID` |

---

## Revenue Agent Map

| Agent | Schedule | Revenue Impact |
|-------|---------|----------------|
| `api/sales-agent.js` | Daily 9am IST | D3 + D7 nurture → trial conversion |
| `api/churn-agent.js` | Daily 2am UTC | D14/D30/D60 retention + dunning |
| `api/ab-agent.js` | Weekly | Optimize conversion rates |
| `api/ads-agent.js` | Weekly | Paid acquisition copy |

---

## MRR Tracking

Store in Redis (update on each PayPal webhook):
```
mrr:current               → current MRR in cents
mrr:history:{YYYY-MM}     → MRR snapshot at month end
mrr:upgrades:{YYYY-MM}    → new revenue from upgrades
mrr:churned:{YYYY-MM}     → revenue lost to churn
```

---

## Cohort Revenue Analysis

Key questions to answer monthly:
1. Which signup month cohort converts best? (Day/time/source)
2. What is average time from signup to paid?
3. What plan do most users land on?
4. What is LTV by acquisition channel?

---

## Cron Schedule (vercel.json)

All revenue-critical agents on schedule:
```json
{
  "crons": [
    { "path": "/api/sales-agent", "schedule": "0 3 * * *" },
    { "path": "/api/churn-agent", "schedule": "0 2 * * *" },
    { "path": "/api/ab-agent", "schedule": "0 6 * * 1" },
    { "path": "/api/ads-agent", "schedule": "0 7 * * 1" },
    { "path": "/api/community-agent", "schedule": "0 5 * * *" },
    { "path": "/api/directory-agent", "schedule": "0 8 * * 1" },
    { "path": "/api/cro-agent", "schedule": "0 9 * * 1" }
  ]
}
```

---

## Revenue Health Dashboard (Admin)

The admin panel should show:
- Current MRR
- Active subscribers by tier breakdown
- New trials this week
- Churn events this week
- Dunning queue size
- Trial → paid rate (rolling 30 days)

All readable from Redis keys above.

---

## Escalation Thresholds (Alert Admin)

Alert when:
- 3+ payment failures in 24 hours (possible PayPal API issue)
- Churn spike: 5+ cancellations in one day
- Trial conversion rate < 10% for 7+ days
- MRR drops >10% week-over-week
