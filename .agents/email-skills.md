# OrreryX — Email Marketing Skills

> Reference for all outbound emails: welcome, nurture, retention, upgrade, and transactional.

---

## Voice Rules

- Write like a person, not a newsletter template
- Short sentences. Short paragraphs. One idea per paragraph.
- Never use "I hope this email finds you well"
- Never use "As per my last email"
- Avoid passive voice
- Sign off as "— The OrreryX Team" or first name if personal

---

## Subject Line Rules

**Cold/nurture emails:** 2–4 words, lowercase, no punctuation
Examples: `markets moved today`, `worth the upgrade?`, `still getting value?`, `one month in`

**Transactional:** Functional, clear
Examples: `Your OrreryX login link`, `Payment confirmed — Analyst tier active`

**Never use:**
- ALL CAPS in subjects
- Excessive punctuation (`!!!`)
- Spammy openers ("FREE", "ACT NOW", "URGENT")
- Emoji in subjects (test-dependent)

**Open rate test:** Subject + preview text must answer "why read this right now?"

---

## Email Sequence Map

### Onboarding (Days 0–7)
| Trigger | Subject | Goal |
|---------|---------|------|
| Signup | `your link is ready` | Activate trial |
| D+1 (if no login) | `did you open it?` | Re-engage |
| D+3 | `markets moved today` | Show product value |
| D+7 | `worth the upgrade?` | Trial → paid |

### Retention (Months 1–3)
| Trigger | Subject | Goal |
|---------|---------|------|
| D+14 | `still getting value?` | Check-in + reduce churn |
| D+30 | `one month in` | Reinforce habit |
| D+60 | `we miss you` | Win-back |

### Dunning (Payment failure)
| Day | Subject | Goal |
|----|---------|------|
| D+1 | `payment didn't go through` | Soft recovery |
| D+4 | `quick reminder` | Urgency |
| D+10 | `last chance` | Final save + downgrade offer |

---

## Email Structure Template

```
Hey,

[1 sentence hook — the reason you're emailing]

[1–2 paragraphs of value, context, or story]

[Single CTA button]

[1-line human close]
— The OrreryX Team
```

No more than 3 sections. If it takes more than 45 seconds to read, cut it.

---

## CTA Button Rules

- One button per email. Never two.
- Dark button (`#0f172a`) for free-tier prompts
- Gold button (`#d4a843`) for paid upgrade prompts
- Text: action-oriented ("Open OrreryX →", "See Analyst plan →", "Resume access →")

---

## Personalization Tokens

Use these when available:
- `{{email}}` — subscriber email (for unsubscribe links)
- `{{plan}}` — current plan (starter / analyst / command / free)
- `{{signedUpAt}}` — signup date (for dynamic "X days ago" messaging)

---

## Footer Requirements

Every email must include:
```html
You signed up at orreryx.io · 
<a href="https://orreryx.io/unsubscribe?email={{email}}">Unsubscribe</a>
```

---

## A/B Testing Email

Always test one variable at a time:
1. Subject line (most impact)
2. CTA button text
3. Email length (short vs. detailed)
4. Send time (9am vs. 6pm)

Wait for statistical significance (p < 0.05) before declaring a winner. See `ab-testing-skills.md`.
