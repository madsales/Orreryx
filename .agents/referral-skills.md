# OrreryX — Referral Program Skills

> How the OrreryX referral program works and how to promote it.

---

## Referral Infrastructure

Handled by `api/referral-agent.js`.

### How It Works
1. User gets a unique referral code: `ORX-XXXXXX`
2. Share link: `https://orreryx.io/login?ref={code}`
3. When 3 referred users complete signup → referrer earns 1 free month
4. Referral counted on: `?action=convert POST {referredEmail, referralCode}`

### Redis Schema
```
referral:code:{code}       → { code, ownerEmail, createdAt, uses: 0 }
referral:user:{email}      → { code, totalReferrals, rewardsClaimed, lastReward }
referral:total             → total referrals across all users (counter)
```

### Reward Email Subject
`you earned a free month`

---

## Referral Program Messaging

**In-app prompt (after first login):**
> "Know someone who follows geopolitics and investing? Give them your link — when 3 friends join, you get a free month."

**In upgrade confirmation email:**
> "P.S. Know other investors who'd find OrreryX useful? Your referral link is [link]. 3 signups = 1 free month for you."

**In D30 retention email:**
> "One more thing — if you've found OrreryX useful, we'd love your referral. 3 friends = 1 free month on us."

---

## Goal-Gradient Mechanics

Show users how close they are to the reward:

| Referrals | Message |
|-----------|---------|
| 0 | "Share your link. 3 referrals = 1 free month." |
| 1 | "1 of 3 referrals done. 2 more friends = free month." |
| 2 | "Almost there — 1 more referral = free month unlocked." |
| 3+ | "You earned a free month! Thanks for spreading the word." |

---

## Referral Program Distribution

**Where to surface the referral CTA:**
1. In-app dashboard: referral widget (sidebar or header)
2. Post-payment confirmation email
3. D30 retention email
4. D7 email (after upgrade CTA): "Or share OrreryX and earn free months"
5. Discord: pinned referral link in #general

---

## Anti-Abuse Rules

- 1 referral code per email address
- Referred user must be a new email (no self-referral)
- Referral counted only on completed signup, not just link click
- Max 1 free month reward per 3 referrals (no unlimited stacking without review)
- Flag: same IP for referrer + referred (potential self-abuse)

---

## Referral Metrics to Track

| Metric | Target |
|--------|--------|
| Users who share their link | >15% of paid users |
| Referrals per sharer | >2 avg |
| Referral → signup conversion | >25% |
| Referral-sourced signups (% of total) | >10% |

Track in Redis:
- `referral:total` (overall counter)
- `referral:user:{email}` (per-user stats)
- Weekly check in `api/referral-agent.js?action=stats`

---

## Referral as a Virality Engine

The goal is that referrals generate a K-factor > 0.1:
- If 10% of users refer 1+ person, and 25% of those sign up: K = 0.025
- To reach K > 0.1: need 40%+ share rate or 50%+ referral conversion

**To improve referral share rate:**
- Make sharing frictionless (one click to copy link)
- Make the reward tangible ("free month" > "credits" > "discount")
- Trigger the ask at peak satisfaction moments (right after upgrade, after aha moment)

**To improve referral conversion:**
- Referred user lands on personalized page: "[Name] thinks you'll find this useful"
- Referred user gets same 3-day trial (no extra barrier)
