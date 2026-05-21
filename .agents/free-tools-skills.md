# OrreryX — Free Tools Skills

> How to build and use free tools as acquisition drivers.

---

## Strategy

Free tools convert visitors who aren't ready to sign up for OrreryX but want immediate value. They build trust, generate backlinks, and drive high-intent traffic.

**Principle:** The free tool should solve one slice of the problem OrreryX solves in full.

---

## OrreryX Free Tool Ideas (Prioritized)

### 1. Geopolitical Risk Heatmap (Embeddable Widget)
- **What:** A simple embeddable widget showing top 3 active conflict zones + their market risk level
- **Who it's for:** Finance bloggers, newsletter writers, news sites
- **Acquisition play:** Every embed includes "Powered by OrreryX → orreryx.io"
- **Build:** Vercel edge function serving a lightweight widget JS

### 2. "What's Moving Markets Today" Free Daily Email
- **What:** A single-sentence daily brief: "[Event] is driving [asset] today. Full analysis at OrreryX."
- **Who it's for:** Retail investors who want a daily signal, not a full platform
- **Acquisition play:** Every email links back to OrreryX; subscribers see upgrade CTA after 7 days
- **Build:** Lightweight cron + Resend; no login required, just email signup

### 3. War Stocks Screener (Public, Limited)
- **What:** A free page on orreryx.io showing top defense/energy stocks with YTD performance and conflict exposure score
- **Who it's for:** Investors looking for "war stock" plays
- **Acquisition play:** Rows blur out after 5 — "Unlock full screener with free trial"
- **SEO play:** Target "war stocks list 2024", "best defense stocks during conflict"

### 4. Geopolitical Risk Score (Per Country, Free API)
- **What:** Free API endpoint returning a 1–10 risk score per country based on conflict data
- **Who it's for:** Developers, data scientists, journalists
- **Acquisition play:** API key required → email signup → nurture sequence
- **Backlink play:** Developers who use it will write about it

### 5. "Iran Oil Risk Calculator"
- **What:** Input a portfolio oil exposure → output estimated % impact if Iran escalates
- **Who it's for:** Retail investors with oil ETF or commodity exposure
- **SEO play:** "iran oil price calculator", "how iran affects my portfolio"

---

## Free Tool Distribution

For each tool:
1. **Product Hunt:** Submit as a free product (separate from main OrreryX PH launch)
2. **Reddit:** Post in r/investing, r/dataisbeautiful, r/geopolitics (genuine value post)
3. **Twitter:** Thread showing it in action, CTA to try it
4. **Hacker News:** "Show HN: Free [tool name]"
5. **Email list:** Announce to OrreryX newsletter subscribers as a bonus

---

## Free Tool → Conversion Path

```
Free tool visit
  → "Want more depth?" CTA
  → OrreryX free trial (no credit card)
  → Day-7 upgrade email
  → Paid conversion
```

The free tool email (e.g., "What's Moving Markets Today") feeds directly into the existing sales-agent.js nurture sequence.

---

## Free Tool Maintenance

- Review tool accuracy monthly (data sources can change)
- Add "Last updated: [date]" to every free tool page
- Track: visitors, CTA clicks, trial signups attributed to each tool
- Kill a tool if it generates <50 trial signups in 3 months and can't be fixed

---

## Virality Mechanics for Free Tools

Add sharing incentive to each tool:
- "Share this with a fellow investor →" link (Twitter, WhatsApp)
- "Embed on your site" snippet for widget tools
- "Get the daily version" email optin for calculator tools

Goal: each tool user brings 0.3+ additional users organically.
