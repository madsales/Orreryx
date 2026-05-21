# OrreryX — Lead Magnets Skills

> How to create, distribute, and convert with lead magnets.

---

## What a Lead Magnet Does for OrreryX

A lead magnet exchanges useful content for an email address. For OrreryX:
- Captures emails from visitors who aren't ready to trial
- Filters for high-intent users (geopolitics + investing overlap)
- Feeds into the nurture email sequence (sales-agent.js D3/D7)

**Best lead magnets for OrreryX:** Specific, fast-to-consume, immediately applicable to investing decisions.

---

## Lead Magnet Ideas (Prioritized by Likely Conversion)

### 1. "The OrreryX Conflict-to-Market Cheat Sheet" (PDF)
- **What:** 1-page reference: 8 conflict zones + 3 assets each one moves + direction + historical example
- **Why it works:** Immediately useful, reference material (kept)
- **Format:** PDF, branded, clean design
- **Optin CTA:** "Get the free cheat sheet — no signup, just email"

### 2. "Weekly Geopolitical Risk Briefing" (Email)
- **What:** Weekly 3-paragraph email: top conflict development + market implication + what OrreryX is tracking
- **Why it works:** Builds habit, demonstrates product value before trial
- **Format:** Plain text email, sent Monday morning
- **Optin CTA:** "Get the free weekly briefing"
- **Nurture:** After 4 weeks, prompt free trial

### 3. "War Stocks Watchlist 2024" (Google Sheet / PDF)
- **What:** Curated list of 15 defense/energy stocks, why each one matters for geopolitical risk, with OrreryX conflict exposure tags
- **Why it works:** High practical value, shareworthy
- **Format:** PDF or live Google Sheet
- **Optin CTA:** "Get the war stocks watchlist (free)"

### 4. "How to Read Geopolitical Risk Like a Hedge Fund Analyst" (Mini-Guide)
- **What:** 5-page guide: how pros connect conflict events to asset movements, with OrreryX examples
- **Why it works:** Educational, positions OrreryX as the expert tool
- **Format:** PDF or web page
- **Optin CTA:** "Free guide: read geopolitical risk like a pro"

### 5. "Iran Oil Risk: What Investors Need to Know" (Report)
- **What:** Focused 3-page briefing on Iran conflict drivers, oil sensitivity, and how to position
- **Why it works:** Timely, specific, SEO-relevant
- **Format:** PDF
- **Optin CTA:** "Free Iran oil risk report"
- **SEO landing page:** `/free/iran-oil-risk-report`

---

## Lead Magnet Delivery

Handled by `api/lead-magnet-agent.js`:
1. User submits email on lead magnet landing page
2. Email stored in Redis: `sub:{email}` with `source: "lead-magnet:{slug}"`
3. Resend delivers the lead magnet (PDF link or content directly)
4. Subscriber enters existing sales nurture sequence (D3, D7 emails)

---

## Landing Page Structure for Lead Magnets

```
Headline: What you get (specific)
Subhead: Who it's for + the problem it solves
Visual: Cover image / preview of the PDF
Bullet list: 3 specific things they'll learn/get
Email form: [email] + "Send me the [lead magnet]"
Reassurance: "No spam. Unsubscribe anytime. Takes 5 seconds."
```

**Lead magnet landing page URLs:**
- `/free/conflict-market-cheatsheet`
- `/free/weekly-briefing`
- `/free/war-stocks-watchlist`
- `/free/hedge-fund-geopolitics-guide`
- `/free/iran-oil-risk-report`

---

## Lead Magnet Distribution

For each lead magnet:
1. **SEO:** Landing page targets related keyword ("war stocks list free", "iran oil risk report")
2. **Social:** Twitter thread teasing the content + link to landing page
3. **Reddit:** Post the core insight, then "I put this together as a free PDF: [link]"
4. **Partner newsletter:** Swap with complementary finance/geopolitics newsletter
5. **Direct outreach:** DM to relevant Twitter accounts: "Made this for you, no strings"

---

## Conversion Metrics for Lead Magnets

| Metric | Target |
|--------|--------|
| Landing page → email optin | >25% |
| Lead magnet → trial (within 14 days) | >10% |
| Lead magnet → paid (within 30 days) | >5% |

If optin rate < 15%, rewrite the headline and CTA.
If trial rate < 5% in 30 days, improve the nurture sequence.
