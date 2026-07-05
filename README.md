# World Cup 2026 Sweepstakes Leaderboard

A single-page, front-end-only leaderboard for an office World Cup sweepstakes.
Each player is assigned three teams (a favourite, a mid-range pick, and an
underdog) and scores points based on how far each team progresses. It runs as a
static site — no backend — and pulls live results from a free, no-key API at
page load.

## Scoring

| Stage a team reaches | Points |
| --- | --- |
| Group stage exit | 1 |
| Round of 32 | 2 |
| Round of 16 | 3 |
| Quarter-final | 5 |
| Semi-final | 8 |
| Runner-up | 10 |
| Winner | 12 |

A team scores the value of the **furthest stage it reaches**. Each player's
total is the sum of their three teams. (The 2026 tournament has 48 teams, hence
the extra Round of 32 compared with older formats.)

## How it works

- **Live results:** fetched from
  [`openfootball/worldcup.json`](https://github.com/openfootball/worldcup.json)
  via the jsDelivr CDN — public domain, no API key, CORS-enabled, so it can be
  called straight from the browser. The app reads the match data and works out
  each team's furthest stage from the scores (handling extra time and
  penalties).
- **Manual overrides / fallback:** `results-overrides.json` lets you hand-set
  any team's stage. These always win over the live feed, and are used on their
  own if the feed is ever unreachable. Handy when the free feed lags behind a
  just-finished match.

## Editing

**Players and their teams** — edit `participants.json`:

```json
{ "name": "Alex", "teams": { "favourite": "Brazil", "midRange": "Japan", "underdog": "Haiti" } }
```

Team names must match the tournament data (matching is case- and
accent-insensitive). The 48 teams:

Mexico, South Africa, South Korea, Czech Republic, Canada, Bosnia & Herzegovina,
Qatar, Switzerland, Brazil, Morocco, Haiti, Scotland, USA, Paraguay, Australia,
Turkey, Germany, Curaçao, Ivory Coast, Ecuador, Netherlands, Japan, Sweden,
Tunisia, Belgium, Egypt, Iran, New Zealand, Spain, Cape Verde, Saudi Arabia,
Uruguay, France, Senegal, Iraq, Norway, Argentina, Algeria, Austria, Jordan,
Portugal, DR Congo, Uzbekistan, Colombia, England, Croatia, Ghana, Panama.

**Correcting a result** — edit `results-overrides.json`:

```json
{ "teamStages": { "Brazil": "winner", "France": "runner-up" } }
```

Valid stages: `group`, `round-of-32`, `round-of-16`, `quarter-final`,
`semi-final`, `runner-up`, `winner`.

## Running locally

Because it uses `fetch`, open it through a local server rather than `file://`:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying on GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   branch `main`, folder `/ (root)`, and save.
4. The site goes live at `https://<user>.github.io/<repo>/` within a minute or
   two. (`.nojekyll` is included so all files are served as-is.)

## Alternative data source: football-data.org

[football-data.org](https://www.football-data.org/) also covers the FIFA World
Cup on its free tier, but it's a poorer fit for a static site:

- It requires a free API key sent as an `X-Auth-Token` header — that key would
  be **visible in your page source**, and anyone could burn through your quota
  (free tier is ~10 requests/minute).
- The free tier serves **delayed, not real-time**, scores.

If you still want to use it, add a fetch in `app.js` that calls
`https://api.football-data.org/v4/competitions/WC/matches` with your token, and
map its `stage` / `score` fields onto the same stage keys this app already uses.
The openfootball feed is the default precisely because it needs no key and can
be called directly from the browser.
