# OrreryX — Programmatic SEO Skills

> How to generate and optimize high-intent landing pages at scale.

---

## SEO Opportunity for OrreryX

OrreryX can rank for high-intent queries combining:
- Conflict names + market assets: "ukraine russia oil price impact"
- Country + asset: "iran oil sanctions", "taiwan strait semiconductor risk"
- "how [event] affects [asset]": "how war affects gold price"
- Comparison: "bloomberg alternative for retail investors"
- "geopolitical risk [asset]": "geopolitical risk gold", "geopolitical risk oil"

---

## Page Template Structure

For each conflict zone × asset combination, generate a landing page:

**URL pattern:** `/intelligence/[conflict-slug]/[asset-slug]`

Examples:
- `/intelligence/iran/oil-futures`
- `/intelligence/ukraine-russia/wheat-prices`
- `/intelligence/taiwan-strait/semiconductors`
- `/intelligence/india-pakistan/gold`

**Page structure:**
1. H1: "[Conflict] Impact on [Asset]: Live Data & Analysis"
2. Hero: Live price widget for the asset
3. Why this conflict matters for [asset] (2–3 paragraphs)
4. Historical: How this conflict has moved [asset] before
5. OrreryX live feed: Recent events from this conflict zone
6. CTA: "Track [asset] impact live → orreryx.io/app"
7. Related: Links to other conflicts affecting this asset

---

## Target Keywords by Volume (Priority)

**High volume, moderate competition:**
- "ukraine russia oil price" (~2,400/mo)
- "iran sanctions oil price" (~1,900/mo)
- "how war affects stock market" (~1,600/mo)
- "geopolitical risk investing" (~880/mo)
- "taiwan strait stocks" (~590/mo)
- "bloomberg alternative" (~720/mo)

**Lower volume, lower competition (easier wins):**
- "india pakistan gold safe haven" (~210/mo)
- "north korea missile defense stocks" (~180/mo)
- "red sea shipping oil price" (~320/mo)
- "strait of hormuz oil risk" (~290/mo)

---

## Content Generation Rules for Programmatic Pages

Each programmatic page must have:
- Unique H1 (not templated)
- At least 300 words of unique content per page
- At least 1 internal link to the OrreryX app
- At least 1 data point (current price, recent % move, or historical correlation)
- Canonical tag if content is thin (to avoid duplicate content penalty)

**Never:** Generate 100% identical content across pages with only country/asset name swapped. Google will penalize thin content.

---

## Blog Content for SEO

High-priority long-form posts (target 1,000–2,000 words each):

1. "How Geopolitical Events Affect Oil Prices: A Practical Guide"
2. "War Stocks: Which Defense Companies Benefit From Conflict"
3. "Bloomberg Terminal vs. OrreryX: A Retail Investor's Comparison"
4. "The Strait of Hormuz: Why It Controls 20% of Global Oil"
5. "Gold as a Safe Haven: When It Works (and When It Doesn't)"
6. "Taiwan Strait Risk: What Investors Need to Know About TSMC"
7. "India-Pakistan Tensions: How They Move Emerging Market Assets"

Each post should:
- Target one primary keyword
- Be factually accurate and specific (not generic)
- Include at least 1 OrreryX CTA (subtle, not spammy)
- Link to 2–3 internal pages

---

## Technical SEO Checklist

- [ ] Each page has unique `<title>` tag (60 chars max)
- [ ] Each page has unique meta description (155 chars max)
- [ ] Schema markup: NewsArticle or Dataset for conflict data pages
- [ ] Open Graph tags for social sharing
- [ ] Sitemap.xml includes all programmatic pages
- [ ] Page load time < 2 seconds
- [ ] Mobile-responsive
- [ ] Internal linking: every page links to at least 2 others

---

## GSC Monitoring (Google Search Console)

Track weekly:
- Total impressions and clicks
- Average position for target keywords
- Click-through rate by page
- Core Web Vitals (LCP, FID, CLS)
- Index coverage (check for errors)

Primary GSC property: `https://www.orreryx.io`

Note: Ensure the GSC OAuth account has Owner permission to access full data.
