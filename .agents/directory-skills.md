# OrreryX — Directory Submission Skills

> How to submit OrreryX to directories and manage listing quality.

---

## Directory Infrastructure

Handled by `api/directory-agent.js`.

### Actions
- `?action=list` — view all directory statuses
- `?action=update POST` — mark a directory as submitted/listed
- `?action=checklist` — get Product Hunt launch checklist
- Default cron (weekly) — emails admin status report

---

## Directory Tiers

### Tier 1 — Submit First (Highest Traffic/SEO Value)
| Directory | URL | Notes |
|-----------|-----|-------|
| Product Hunt | producthunt.com | Full launch day required |
| BetaList | betalist.com | Good for pre-launch buzz |
| Hacker News Show HN | news.ycombinator.com | Post "Show HN: OrreryX — [tagline]" |

### Tier 2 — Software Review Sites (SEO + Credibility)
| Directory | URL | Notes |
|-----------|-----|-------|
| G2 | g2.com | Claim listing, request reviews |
| Capterra | capterra.com | Strong SEO for "bloomberg alternative" queries |
| AlternativeTo | alternativeto.net | Appear as alternative to Bloomberg, Stratfor |
| SaaSHub | saashub.com | Good for developer/analyst audience |
| GetApp | getapp.com | SMB/professional audience |

### Tier 3 — AI/Tools Directories
| Directory | URL | Notes |
|-----------|-----|-------|
| There's An AI For That | theresanaiforthat.com | High traffic AI directory |
| Futurepedia | futurepedia.io | Growing AI tools directory |
| AI Tools Directory | aitoolsdirectory.com | |
| Tool Finder | toolfinder.co | |

---

## Standard Listing Copy

**Tagline (60 chars):**
> Real-time geopolitical risk → market impact

**Short description (160 chars):**
> OrreryX tracks 13 live conflict zones and maps them to market impact — oil, gold, defense stocks, crypto. Real-time. From $0.99/month.

**Long description (300 chars):**
> OrreryX is a real-time geopolitical intelligence platform for investors and traders. It tracks 13 live conflict zones — Ukraine, Iran, Taiwan, and more — and translates each event into direct market impact data. Live conflict-to-asset mapping for oil, gold, defense stocks, crypto. Bloomberg-quality signal at $14.99/month. Free trial, no credit card.

**Categories to select:**
- Finance / Fintech
- Investment Tools
- News & Intelligence
- AI Tools
- Market Data

**Website:** https://www.orreryx.io
**App:** https://orreryx.io/app
**Pricing:** From $0.99/month (free trial available)

---

## G2 / Capterra Review Strategy

After listing:
1. Email existing users: "We just listed on G2 — honest review appreciated: [link]"
2. Reply to every review (positive and negative) within 48 hours
3. Aim for minimum 5 reviews to show star rating
4. Don't incentivize reviews (violates policies)

**Review request email subject:** `quick favor?`

```
Hey,

We recently listed OrreryX on G2. If you've found it useful, 
an honest review would mean a lot — takes 2 minutes:

[Leave a review →]

Thanks for being a user.
— The OrreryX Team
```

---

## AlternativeTo Strategy

AlternativeTo generates organic traffic from people searching for alternatives to Bloomberg, Reuters, Stratfor.

To maximize:
1. Submit OrreryX to AlternativeTo
2. List it as an alternative to: Bloomberg Terminal, Stratfor, Reuters, Geopolitical Futures
3. Ensure the OrreryX description emphasizes the price contrast

Users searching "Bloomberg alternative" or "Stratfor alternative" should find OrreryX.

---

## Hacker News "Show HN" Post

**Title format:**
> Show HN: OrreryX – Real-time geopolitical risk to market impact, from $0.99/month

**Post body (plain text, no markdown):**
```
I built OrreryX after noticing that retail investors have no real-time 
tool connecting geopolitical events to market movements. Bloomberg costs 
$2,000+/month and isn't designed for individuals.

OrreryX tracks 13 live conflict zones and maps each event to affected 
assets — oil, gold, defense stocks, crypto, emerging markets.

Free trial at orreryx.io/app — no credit card required.

Happy to answer any questions about the tech stack or data sources.
```

**Best time to post:** Tuesday 10am–12pm ET
**Engage:** Reply to every comment within 30 minutes for first 2 hours

---

## Directory Submission Checklist (Per Listing)

- [ ] Tagline written (60 chars)
- [ ] Short description written (160 chars)
- [ ] Long description written (300 chars)
- [ ] Screenshots ready (1270×952px, 3–5 shots)
- [ ] Logo uploaded (square PNG, 500×500px minimum)
- [ ] Categories selected
- [ ] Pricing entered accurately
- [ ] Website and app URL correct
- [ ] Free trial noted in listing
- [ ] Mark as submitted in `api/directory-agent.js`
