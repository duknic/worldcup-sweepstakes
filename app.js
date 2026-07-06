/* World Cup 2026 Sweepstakes leaderboard
 * Pure front-end. Fetches live match data (no API key) and computes each
 * team's furthest stage + whether it's still in, then each player's total.
 */

// ---- Config -----------------------------------------------------------------

const CONFIG = {
  // Live data source: openfootball, public domain, no key, CORS-enabled.
  // We try raw.githubusercontent.com first because it reflects the latest commit
  // almost immediately; the jsDelivr CDN mirror is a fallback (fast, but can
  // serve a snapshot that's several hours stale).
  liveDataUrls: [
    "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json",
    "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json",
  ],

  // Bundled fallback (and manual override) shipped in this repo. Used when the
  // live source is unreachable, and always applied on top of live data so you
  // can hand-correct results the feed hasn't caught up on yet.
  overridesUrl: "results-overrides.json",

  participantsUrl: "participants.json",

  // Shown in the prizes strip at the bottom — edit freely.
  prizes: [
    { icon: "🥇", amount: "£30", label: "1st place" },
    { icon: "🥈", amount: "£10", label: "2nd place" },
    { icon: "🥄", amount: "£3", label: "Wooden spoon" },
  ],
};

// Points for the FURTHEST stage a team reaches.
const STAGE_POINTS = {
  group: 1, // in the tournament / eliminated in the group stage
  "round-of-32": 2,
  "round-of-16": 3,
  "quarter-final": 5,
  "semi-final": 8, // includes both third-place play-off teams
  "runner-up": 10,
  winner: 12,
};

// Human labels for the UI.
const STAGE_LABEL = {
  group: "Group stage",
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  "quarter-final": "Quarter-final",
  "semi-final": "Semi-final",
  "runner-up": "Runner-up",
  winner: "Winner",
};

// Ordered so we can take the "furthest" reached. `final` is a placeholder rank
// that later resolves into winner / runner-up.
const STAGE_RANK = {
  group: 0,
  "round-of-32": 1,
  "round-of-16": 2,
  "quarter-final": 3,
  "semi-final": 4,
  final: 5,
};

// Map an openfootball round string to one of our stage keys.
function roundToStage(round) {
  const r = (round || "").toLowerCase();
  if (r.includes("round of 32")) return "round-of-32";
  if (r.includes("round of 16")) return "round-of-16";
  if (r.includes("quarter")) return "quarter-final";
  if (r.includes("semi")) return "semi-final";
  if (r.includes("third place")) return "semi-final"; // reached SF, lost it
  if (r.includes("final")) return "final";
  return "group"; // "Matchday N"
}

// ---- Helpers ----------------------------------------------------------------

// Normalise team names so "Côte d'Ivoire" == "Cote d Ivoire" etc.
function norm(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The 2026 openfootball feed stores results as
//   "score": { "ht": [a,b], "ft": [a,b], "et": [a,b], "pen": [a,b] }
// Older feeds used flat score1/score2 (+ ...et / ...p). Support both.
function pair(v) {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
    ? v
    : null;
}

// Full-time (or however far it was played) result as [a, b], or null if unplayed.
function resultPair(m) {
  if (m && m.score) {
    return pair(m.score.ft) || pair(m.score.et) || pair(m.score.pen) || pair(m.score.p) || null;
  }
  if (typeof m.score1 === "number" && typeof m.score2 === "number") return [m.score1, m.score2];
  return null;
}

// The pair that DECIDES the tie: penalties beat extra time beat full time.
function decisivePair(m) {
  if (m && m.score) {
    return pair(m.score.pen) || pair(m.score.p) || pair(m.score.et) || pair(m.score.ft) || null;
  }
  if (typeof m.score1p === "number" && typeof m.score2p === "number") return [m.score1p, m.score2p];
  if (typeof m.score1et === "number" && typeof m.score2et === "number") return [m.score1et, m.score2et];
  if (typeof m.score1 === "number" && typeof m.score2 === "number") return [m.score1, m.score2];
  return null;
}

function isPlayed(m) {
  return resultPair(m) !== null;
}

// Winner of a played knockout match, accounting for extra time & penalties.
function matchWinner(m) {
  const d = decisivePair(m);
  if (!d) return null;
  if (d[0] > d[1]) return m.team1;
  if (d[1] > d[0]) return m.team2;
  return null;
}

// True once every match of the earliest knockout round has both real teams
// (i.e. the group stage is over and the draw has been made).
function firstKnockoutRoundDrawn(matches, realTeams) {
  const koRanks = matches
    .map((m) => STAGE_RANK[roundToStage(m.round)])
    .filter((r) => r >= 1);
  if (!koRanks.length) return false;
  const firstRank = Math.min(...koRanks);
  const firstRoundMatches = matches.filter(
    (m) => STAGE_RANK[roundToStage(m.round)] === firstRank
  );
  return (
    firstRoundMatches.length > 0 &&
    firstRoundMatches.every(
      (m) => realTeams.has(norm(m.team1)) && realTeams.has(norm(m.team2))
    )
  );
}

// ---- Core: derive each team's stage from match data -------------------------

function deriveStages(data) {
  const matches = (data && data.matches) || [];

  // Real team names = everyone who appears in a group-stage match.
  const realTeams = new Set();
  for (const m of matches) {
    if (roundToStage(m.round) === "group") {
      if (m.team1) realTeams.add(norm(m.team1));
      if (m.team2) realTeams.add(norm(m.team2));
    }
  }

  const best = {}; // normName -> { rank, stageKey, displayName }
  const eliminated = {}; // normName -> true (lost a played knockout match)
  let champion = null;
  let runnerUp = null;

  const bump = (team, stageKey) => {
    const n = norm(team);
    if (!realTeams.has(n)) return; // ignore placeholders like "2A" / "W74"
    const rank = STAGE_RANK[stageKey];
    if (!best[n] || rank > best[n].rank) {
      best[n] = { rank, stageKey, displayName: team };
    }
  };

  for (const m of matches) {
    const stage = roundToStage(m.round);
    bump(m.team1, stage);
    bump(m.team2, stage);

    if (stage === "group") continue;

    const w = matchWinner(m);
    if (!w) continue;
    const loser = norm(w) === norm(m.team1) ? m.team2 : m.team1;
    if (realTeams.has(norm(loser))) eliminated[norm(loser)] = true;

    if ((m.round || "").toLowerCase().includes("third place")) {
      // Both third-place teams are already out.
      if (realTeams.has(norm(m.team1))) eliminated[norm(m.team1)] = true;
      if (realTeams.has(norm(m.team2))) eliminated[norm(m.team2)] = true;
    }
    if (stage === "final") {
      champion = w;
      runnerUp = norm(w) === norm(m.team1) ? m.team2 : m.team1;
    }
  }

  // Is the first knockout round fully drawn with real teams? Only then can we
  // say a group-stage team that isn't in it has been eliminated. We DON'T infer
  // knockout elimination from later rounds being drawn — ties are staggered
  // across days, so a surviving team can simply be waiting for its next match.
  const bracketDrawn = firstKnockoutRoundDrawn(matches, realTeams);

  // Convert to final stage keys + points + elimination. A team is out ONLY if
  // it actually lost a played knockout match, or (for group-only teams) the
  // knockout draw exists and it didn't make it.
  const result = {};
  for (const [n, info] of Object.entries(best)) {
    let stageKey = info.stageKey;
    if (stageKey === "final") stageKey = "runner-up"; // reached final, default
    const reachedKnockout = info.rank >= 1;
    const elim = reachedKnockout ? !!eliminated[n] : !!eliminated[n] || bracketDrawn;
    result[n] = {
      stage: stageKey,
      points: STAGE_POINTS[stageKey],
      displayName: info.displayName,
      eliminated: elim,
    };
  }

  // Safety net for any real team that somehow never appeared above.
  for (const n of realTeams) {
    if (!result[n]) {
      result[n] = {
        stage: "group",
        points: STAGE_POINTS.group,
        displayName: n,
        eliminated: bracketDrawn,
      };
    }
  }

  // Apply final result: champion stays in, runner-up is out.
  if (champion) {
    const cn = norm(champion);
    result[cn] = {
      stage: "winner",
      points: STAGE_POINTS.winner,
      displayName: champion,
      eliminated: false,
    };
  }
  if (runnerUp) {
    const rn = norm(runnerUp);
    result[rn] = {
      stage: "runner-up",
      points: STAGE_POINTS["runner-up"],
      displayName: runnerUp,
      eliminated: true,
    };
  }

  return result;
}

// Manual overrides win over derived data. Shape: { "teamStages": { "Brazil": "winner" } }
// An overridden stage is treated as a settled result: anything but "winner" = out.
function applyOverrides(stages, overrides) {
  const map = (overrides && overrides.teamStages) || {};
  for (const [team, stageKey] of Object.entries(map)) {
    if (!(stageKey in STAGE_POINTS)) {
      console.warn(`Unknown stage "${stageKey}" for ${team} in overrides — ignored.`);
      continue;
    }
    stages[norm(team)] = {
      stage: stageKey,
      points: STAGE_POINTS[stageKey],
      displayName: team,
      eliminated: stageKey !== "winner",
      overridden: true,
    };
  }
  return stages;
}

// ---- Scoring players --------------------------------------------------------

function stageForTeam(stages, teamName) {
  if (!teamName) return null;
  return (
    stages[norm(teamName)] || {
      stage: "group",
      points: STAGE_POINTS.group,
      displayName: teamName,
      eliminated: false,
      unknown: true,
    }
  );
}

// Knockout fixtures with both teams known (real names). Group games are skipped
// because two teams meeting there can both still advance — only knockouts are
// single-elimination, where a head-to-head guarantees one team is out.
function extractFixtures(data) {
  const matches = (data && data.matches) || [];
  const realTeams = new Set();
  for (const m of matches) {
    if (roundToStage(m.round) === "group") {
      if (m.team1) realTeams.add(norm(m.team1));
      if (m.team2) realTeams.add(norm(m.team2));
    }
  }
  const isReal = (t) => realTeams.has(norm(t));
  const fixtures = [];
  for (const m of matches) {
    const stage = roundToStage(m.round);
    if (stage === "group") continue;
    if (!isReal(m.team1) || !isReal(m.team2)) continue;
    fixtures.push({
      stage,
      team1: m.team1,
      team2: m.team2,
      played: isPlayed(m),
      winner: matchWinner(m),
    });
  }
  return fixtures;
}

// Find a fixture between two specific teams.
function fixtureBetween(fixtures, a, b) {
  const na = norm(a);
  const nb = norm(b);
  return fixtures.find(
    (f) =>
      (norm(f.team1) === na && norm(f.team2) === nb) ||
      (norm(f.team1) === nb && norm(f.team2) === na)
  );
}

function scorePlayers(participants, stages, fixtures = []) {
  const rows = participants.map((p) => {
    const slots = ["favourite", "midRange", "underdog"].map((slot) => {
      const teamName = p.teams ? p.teams[slot] : null;
      const s = stageForTeam(stages, teamName);
      return { slot, teamName: teamName || "—", ...s };
    });

    // Detect head-to-heads between this participant's own teams.
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const A = slots[i];
        const B = slots[j];
        if (A.teamName === "—" || B.teamName === "—") continue;
        const f = fixtureBetween(fixtures, A.teamName, B.teamName);
        if (!f) continue;
        const stageLabel = STAGE_LABEL[f.stage] || f.stage;
        const mark = (self, other) => {
          self.clash = {
            withTeam: other.teamName,
            stage: f.stage,
            stageLabel,
            played: f.played,
            // undefined until played; true if this team won the tie
            won: f.played && f.winner ? norm(f.winner) === norm(self.teamName) : null,
          };
        };
        mark(A, B);
        mark(B, A);
      }
    }

    const total = slots.reduce((sum, s) => sum + (s.points || 0), 0);
    const alive = slots.filter((s) => s.teamName !== "—" && !s.eliminated).length;
    return { name: p.name, slots, total, alive };
  });

  rows.sort((a, b) => b.total - a.total || b.alive - a.alive || a.name.localeCompare(b.name));

  let lastTotal = null;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.total !== lastTotal) {
      lastRank = i + 1;
      lastTotal = row.total;
    }
    row.rank = lastRank;
  });

  return rows;
}

// ---- Tournament status line -------------------------------------------------

function tournamentStatus(data) {
  const matches = (data && data.matches) || [];
  const order = [
    ["group", "Group stage"],
    ["round-of-32", "Round of 32"],
    ["round-of-16", "Round of 16"],
    ["quarter-final", "Quarter-finals"],
    ["semi-final", "Semi-finals"],
    ["final", "Final"],
  ];
  const realTeams = new Set();
  for (const m of matches) {
    if (roundToStage(m.round) === "group") {
      if (m.team1) realTeams.add(norm(m.team1));
      if (m.team2) realTeams.add(norm(m.team2));
    }
  }
  const isReal = (t) => realTeams.has(norm(t));

  const set = {}; // fixtures with real team names slotted in
  const played = {}; // fixtures with scores
  const total = {};
  for (const m of matches) {
    const s = roundToStage(m.round);
    total[s] = (total[s] || 0) + 1;
    if (isReal(m.team1) && isReal(m.team2)) set[s] = (set[s] || 0) + 1;
    if (isPlayed(m)) played[s] = (played[s] || 0) + 1;
  }

  // The current round is the furthest one whose bracket has been drawn.
  let latest = -1;
  order.forEach(([key], i) => {
    if (set[key]) latest = i;
  });
  if (latest < 0) return "Fixtures loaded · tournament not started";

  const [key, label] = order[latest];
  const allPlayed = total[key] > 0 && (played[key] || 0) >= total[key];
  if (allPlayed) {
    const next = order[latest + 1];
    return next ? `${label} complete · ${next[1]} begins` : "Tournament complete 🏆";
  }
  // Bracket for this round is set but not all games are in.
  return `${label} · in progress`;
}

// ---- Rendering --------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function teamLine(s) {
  const out = s.eliminated;
  const title = s.unknown
    ? ' title="Team name not found in results — check spelling in participants.json"'
    : "";
  const cls = ["team", out ? "out" : "in", s.unknown ? "unknown" : ""].join(" ").trim();
  const marker = out
    ? `<span class="xmark" aria-hidden="true">✕</span>`
    : `<span class="dot" aria-hidden="true"></span>`;
  const stageBit = `${STAGE_LABEL[s.stage] || s.stage} · ${s.points}${s.overridden ? " *" : ""}`;
  const meta = out ? `Out · ${stageBit}` : stageBit;

  // Head-to-head between two of the owner's teams.
  let clashTag = "";
  if (s.clash) {
    const c = s.clash;
    let label;
    let kind;
    if (!c.played) {
      label = `⚔ vs your ${escapeHtml(c.withTeam)} · ${c.stageLabel}`;
      kind = "pending"; // one of them will go out here
    } else if (c.won) {
      label = `⚔ knocked out your ${escapeHtml(c.withTeam)}`;
      kind = "won";
    } else {
      label = `⚔ lost to your ${escapeHtml(c.withTeam)}`;
      kind = "lost";
    }
    clashTag = `<span class="clash ${kind}">${label}</span>`;
  }

  return `
    <li class="${cls}"${title}>
      ${marker}
      <span class="tname">${escapeHtml(s.teamName)}${clashTag}</span>
      <span class="tmeta">${meta}</span>
    </li>`;
}

function rankGlyph(row, isLeader, isSpoon) {
  if (isLeader) return `<span class="glyph trophy">🏆</span>`;
  if (isSpoon) return `<span class="glyph spoon">🥄</span>`;
  return `<span class="num">${row.rank}</span>`;
}

function card(row, isLeader, isSpoon) {
  const badgeClass = isLeader ? "lead" : row.total === 0 ? "zero" : "";
  const cls = ["card", isLeader ? "leader" : "", isSpoon ? "wooden" : ""].join(" ").trim();
  // Summary line when two of this player's teams meet in an upcoming tie.
  const pending = row.slots.filter((s) => s.clash && !s.clash.played);
  let clashNote = "";
  if (pending.length) {
    // Each unplayed clash involves two of the player's teams; de-dupe by stage.
    const byStage = {};
    pending.forEach((s) => {
      byStage[s.clash.stageLabel] = byStage[s.clash.stageLabel] || new Set();
      byStage[s.clash.stageLabel].add(s.teamName);
      byStage[s.clash.stageLabel].add(s.clash.withTeam);
    });
    const parts = Object.entries(byStage).map(([stageLabel, teams]) => {
      const names = [...teams].join(" v ");
      return `${escapeHtml(names)} in the ${stageLabel} — one of yours goes out`;
    });
    clashNote = `<div class="clash-note">⚔ ${parts.join("; ")}</div>`;
  }

  return `
    <article class="${cls}">
      <div class="rank">${rankGlyph(row, isLeader, isSpoon)}</div>
      <div class="body">
        <div class="pname">${escapeHtml(row.name)}</div>
        ${clashNote}
        <ul class="teams">${row.slots.map(teamLine).join("")}</ul>
      </div>
      <div class="pts ${badgeClass}">
        <b>${row.total}</b><span>pt${row.total === 1 ? "" : "s"}</span>
      </div>
    </article>`;
}

function render(rows, status) {
  const statusLine = document.getElementById("status-line");
  if (statusLine) statusLine.textContent = status;

  const board = document.getElementById("board");
  if (!board) return; // stale/mismatched markup — nothing to render into
  if (!rows.length) {
    board.innerHTML = `<p class="empty">No participants yet — add players in participants.json.</p>`;
    return;
  }

  const maxRank = rows[rows.length - 1].rank;
  const leaders = rows.filter((r) => r.rank === 1);
  const rest = rows.filter((r) => r.rank !== 1);
  const leaderPts = leaders[0].total;

  let html = "";
  html += `<div class="section-label gold">${leaders.length > 1 ? "Leaders" : "Leader"} — ${leaderPts} pt${leaderPts === 1 ? "" : "s"}</div>`;
  html += leaders.map((r) => card(r, true, r.rank === maxRank)).join("");

  if (rest.length) {
    html += `<div class="section-label">The rest — in it to win it</div>`;
    html += rest.map((r) => card(r, false, r.rank === maxRank)).join("");
  }
  board.innerHTML = html;

  // Prizes strip
  const prizesEl = document.getElementById("prizes");
  if (prizesEl)
    prizesEl.innerHTML = CONFIG.prizes
    .map(
      (p) => `
      <div class="prize">
        <span class="picon">${p.icon}</span>
        <b>${escapeHtml(p.amount)}</b>
        <small>${escapeHtml(p.label)}</small>
      </div>`
    )
    .join("");
}

function setStatus(msg, kind) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---- Boot -------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let participants = [];
  let overrides = {};
  try {
    const pData = await fetchJson(CONFIG.participantsUrl);
    participants = pData.participants || [];
  } catch (e) {
    setStatus("Could not load participants.json — add players there.", "error");
    return;
  }

  try {
    overrides = await fetchJson(CONFIG.overridesUrl);
  } catch (e) {
    overrides = {};
  }

  let stages = {};
  let fixtures = [];
  let sourceLabel = "";
  let status = "Round underway";
  let live = null;
  for (const url of CONFIG.liveDataUrls) {
    try {
      live = await fetchJson(url);
      break;
    } catch (e) {
      console.warn("Live source failed, trying next:", url, e.message);
    }
  }
  if (live) {
    stages = deriveStages(live);
    fixtures = extractFixtures(live);
    status = tournamentStatus(live);
    sourceLabel = "live results (openfootball)";
    setStatus("Live results loaded · updated " + new Date().toLocaleString("en-GB"), "ok");
  } else {
    status = "Showing manual results";
    sourceLabel = "manual overrides only (live feed unreachable)";
    setStatus(
      "Live results feed unreachable — showing manual results from results-overrides.json.",
      "error"
    );
  }

  stages = applyOverrides(stages, overrides);
  const rows = scorePlayers(participants, stages, fixtures);
  render(rows, status);

  const sourceNote = document.getElementById("source-note");
  if (sourceNote)
    sourceNote.innerHTML =
    `Data: ${sourceLabel} · ` +
    `<a href="https://github.com/openfootball/worldcup.json">openfootball/worldcup.json</a> · ` +
    `* = set manually in results-overrides.json`;
}

if (typeof document !== "undefined") {
  main();
}

// Exposed for the node test harness (test.js); ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deriveStages, applyOverrides, scorePlayers, extractFixtures, tournamentStatus, render, CONFIG, STAGE_POINTS, norm };
}
