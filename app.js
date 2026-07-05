/* World Cup 2026 Sweepstakes leaderboard
 * Pure front-end. Fetches live match data (no API key) and computes each
 * team's furthest stage + whether it's still in, then each player's total.
 */

// ---- Config -----------------------------------------------------------------

const CONFIG = {
  // Primary live data source: openfootball, public domain, no key, CORS-enabled
  // via the jsDelivr CDN. Served straight from GitHub, community-updated.
  liveDataUrl:
    "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json",

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

function isPlayed(m) {
  return typeof m.score1 === "number" && typeof m.score2 === "number";
}

// Winner of a played knockout match, accounting for extra time & penalties.
function matchWinner(m) {
  if (!isPlayed(m)) return null;
  let s1 = m.score1;
  let s2 = m.score2;
  if (typeof m.score1et === "number" && typeof m.score2et === "number") {
    s1 = m.score1et;
    s2 = m.score2et;
  }
  if (typeof m.score1p === "number" && typeof m.score2p === "number") {
    return m.score1p > m.score2p ? m.team1 : m.team2; // penalties decide
  }
  if (s1 > s2) return m.team1;
  if (s2 > s1) return m.team2;
  return null;
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
  const eliminated = {}; // normName -> true
  let champion = null;
  let runnerUp = null;
  let knockoutStarted = false;

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
    if (isPlayed(m)) knockoutStarted = true;

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

  // Convert to final stage keys + points + elimination.
  const result = {};
  for (const [n, info] of Object.entries(best)) {
    let stageKey = info.stageKey;
    if (stageKey === "final") stageKey = "runner-up"; // reached final, default
    result[n] = {
      stage: stageKey,
      points: STAGE_POINTS[stageKey],
      displayName: info.displayName,
      eliminated: !!eliminated[n],
    };
  }

  // Real teams with no knockout appearance sit at the group baseline. If the
  // knockouts have begun, those teams are out.
  for (const n of realTeams) {
    if (!result[n]) {
      result[n] = {
        stage: "group",
        points: STAGE_POINTS.group,
        displayName: n,
        eliminated: knockoutStarted,
      };
    } else if (result[n].stage === "group" && knockoutStarted) {
      result[n].eliminated = true;
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

function scorePlayers(participants, stages) {
  const rows = participants.map((p) => {
    const slots = ["favourite", "midRange", "underdog"].map((slot) => {
      const teamName = p.teams ? p.teams[slot] : null;
      const s = stageForTeam(stages, teamName);
      return { slot, teamName: teamName || "—", ...s };
    });
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
  const played = {};
  const total = {};
  for (const m of matches) {
    const s = roundToStage(m.round);
    total[s] = (total[s] || 0) + 1;
    if (isPlayed(m)) played[s] = (played[s] || 0) + 1;
  }
  let latest = -1;
  order.forEach(([key], i) => {
    if (played[key]) latest = i;
  });
  if (latest < 0) return "Fixtures loaded · tournament not started";
  const [key, label] = order[latest];
  const complete = total[key] > 0 && (played[key] || 0) >= total[key];
  if (complete) {
    const next = order[latest + 1];
    return next ? `${label} complete · ${next[1]} begins` : "Tournament complete 🏆";
  }
  return `${label} underway`;
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
  return `
    <li class="${cls}"${title}>
      <span class="dot" aria-hidden="true"></span>
      <span class="tname">${escapeHtml(s.teamName)}</span>
      <span class="tmeta">${STAGE_LABEL[s.stage] || s.stage} · ${s.points}${s.overridden ? " *" : ""}</span>
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
  return `
    <article class="${cls}">
      <div class="rank">${rankGlyph(row, isLeader, isSpoon)}</div>
      <div class="body">
        <div class="pname">${escapeHtml(row.name)}</div>
        <ul class="teams">${row.slots.map(teamLine).join("")}</ul>
      </div>
      <div class="pts ${badgeClass}">
        <b>${row.total}</b><span>pt${row.total === 1 ? "" : "s"}</span>
      </div>
    </article>`;
}

function render(rows, status) {
  document.getElementById("status-line").textContent = status;

  const board = document.getElementById("board");
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
  document.getElementById("prizes").innerHTML = CONFIG.prizes
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
  let sourceLabel = "";
  let status = "Round underway";
  try {
    const live = await fetchJson(CONFIG.liveDataUrl);
    stages = deriveStages(live);
    status = tournamentStatus(live);
    sourceLabel = "live results (openfootball)";
    setStatus("Live results loaded · updated " + new Date().toLocaleString(), "ok");
  } catch (e) {
    console.error(e);
    status = "Showing manual results";
    sourceLabel = "manual overrides only (live feed unreachable)";
    setStatus(
      "Live results feed unreachable — showing manual results from results-overrides.json.",
      "error"
    );
  }

  stages = applyOverrides(stages, overrides);
  const rows = scorePlayers(participants, stages);
  render(rows, status);

  document.getElementById("source-note").innerHTML =
    `Data: ${sourceLabel} · ` +
    `<a href="https://github.com/openfootball/worldcup.json">openfootball/worldcup.json</a> · ` +
    `* = set manually in results-overrides.json`;
}

if (typeof document !== "undefined") {
  main();
}

// Exposed for the node test harness (test.js); ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deriveStages, applyOverrides, scorePlayers, tournamentStatus, render, CONFIG, STAGE_POINTS, norm };
}
