# OrreryX — Onboarding Skills

> How to activate new users and get them to their first "aha moment" fast.

---

## The Activation Goal

**Aha moment:** User sees a live conflict event and understands how it connects to a market move they care about.

**Target:** User reaches aha moment within first 90 seconds of first login.

**Why it matters:** Users who hit the aha moment in session 1 are 3x more likely to return in week 1 and 2x more likely to convert to paid.

---

## Welcome Email (Sent at Signup)

**Subject:** `your link is ready` (or magic link default subject)

**Body:**
```
Hey,

Your OrreryX access is ready. Click below to open the dashboard.

[Open OrreryX →]

Once you're in, check the live events feed — there's usually something 
moving markets right now. That's the core of what we do.

If you have questions, reply here. I read them.
— The OrreryX Team
```

**Rules:**
- No feature list in welcome email — just one action
- Magic link should be the only CTA
- Don't say "welcome to our platform" — say what to do first

---

## Day +1 Re-engagement (If No Login)

**Subject:** `did you open it?`

**Body:**
```
Hey,

Looks like you haven't opened OrreryX yet — your free trial is running.

Here's what's live right now: [live event from Redis or generic hook]

[Open the dashboard →]

Takes 30 seconds to see what we mean.
— The OrreryX Team
```

---

## In-App Onboarding Sequence

### Step 1: First Dashboard View
- Show the most recent high-impact breaking event prominently
- Show market impact panel alongside it
- No modal popups blocking the view — let them see value first

### Step 2: First Tooltip (5 seconds after load)
> "This event moved oil 1.8% today. Click to see the full analysis."

### Step 3: After First Event Click
> "Set up email alerts — get notified the moment events like this break."
> CTA: "Enable alerts →" (links to settings or Analyst upgrade)

### Step 4: After 3 Events Viewed
> "You've explored 3 events. OrreryX tracks 13 conflict zones in real time. Free trial active — X days left."

---

## Onboarding Email Sequence

| Day | Subject | Action |
|-----|---------|--------|
| 0 | `your link is ready` | First login |
| +1 (no login) | `did you open it?` | Recover inactive |
| +3 | `markets moved today` | Show value, re-engage |
| +7 | `worth the upgrade?` | Trial → paid CTA |

---

## Onboarding Anti-Patterns (Never Do)

- **Empty state:** Never show a blank dashboard. Pre-populate with recent events.
- **Feature wall:** Don't list 10 features before showing any. Show one thing that matters.
- **Long tutorial:** Users skip tutorials. Show, don't tell.
- **Collect info first:** Never ask for name/industry/goals before showing product value.
- **Multiple CTAs:** One action per screen during onboarding.

---

## Activation Metric Targets

| Event | Target Rate |
|-------|------------|
| Magic link clicked (24h) | >70% |
| First event viewed | >60% |
| 3+ events viewed in session 1 | >30% |
| Alert setup or upgrade initiated | >15% |
| Return visit (Day 3) | >40% |

---

## Onboarding for Paid Users (Post-Upgrade)

When a user upgrades to Analyst or Command:
1. Send "you're in" email: confirms upgrade, lists what's now unlocked
2. First login after upgrade: highlight the newly unlocked features (real-time badge, alert setup)
3. Email alert setup prompt: "You now have email alerts — set your first one →"

**Subject of upgrade confirmation:** `analyst access is live`
