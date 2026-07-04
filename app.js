/* World Cup 2026 Sweepstakes leaderboard
 * Pure front-end. Fetches live match data (no API key) and computes each
 * team's furthest stage, then each player's total from their three teams.
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
};

// Points for the FURTHEST stage a team reaches.
const STAGE_POINTS = {
  group: 1, // in the tournament / eliminated in the group stage
  "round-of-32": 2,
  "round-of-16": 3,
  "quarter-final": 4,
  "semi-final": 6, // includes both third-place play-off teams
  "runner-up": 8,
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
    // Penalty shoot-out decides it.
    return m.score1p > m.score2p ? m.team1 : m.team2;
  }
  if (s1 > s2) return m.team1;
  if (s2 > s1) return m.team2;
  return null; // drawn and undecided (shouldn't happen in knockouts)
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

  // Track the furthest rank each team has appeared in, plus final result.
  const best = {}; // normName -> { rank, stageKey, displayName }
  let champion = null;
  let runnerUp = null;

  const bump = (team, stageKey) => {
    const n = norm(team);
    if (!realTeams.has(n)) return; // ignore placeholders like "2A" / "W74"
    const rank = STAGE_RANK[stageKey];
    if (!best[n] || rank > best[n].rank) {
      best[n] = { rank, stageKey, displayName: team };
    } else if (!best[n].displayName) {
      best[n].displayName = team;
    }
  };

  for (const m of matches) {
    const stage = roundToStage(m.round);
    bump(m.team1, stage);
    bump(m.team2, stage);

    if (stage === "final") {
      const w = matchWinner(m);
      if (w) {
        champion = w;
        runnerUp = norm(w) === norm(m.team1) ? m.team2 : m.team1;
      }
    }
  }

  // Convert to final stage keys + points.
  const result = {}; // normName -> { stage, points, displayName }
  for (const [n, info] of Object.entries(best)) {
    let stageKey = info.stageKey;
    if (stageKey === "final") stageKey = "runner-up"; // reached final, lost (default)
    result[n] = {
      stage: stageKey,
      points: STAGE_POINTS[stageKey],
      displayName: info.displayName,
    };
  }

  // Any real team with no knockout appearance sits at the group baseline.
  for (const n of realTeams) {
    if (!result[n]) {
      result[n] = { stage: "group", points: STAGE_POINTS.group, displayName: n };
    }
  }

  // Apply final result.
  if (champion) {
    const cn = norm(champion);
    result[cn] = { stage: "winner", points: STAGE_POINTS.winner, displayName: champion };
  }
  if (runnerUp) {
    const rn = norm(runnerUp);
    result[rn] = { stage: "runner-up", points: STAGE_POINTS["runner-up"], displayName: runnerUp };
  }

  return result;
}

// Manual overrides win over derived data. Shape: { "teamStages": { "Brazil": "winner" } }
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
    return { name: p.name, slots, total };
  });

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Dense-ish ranking with ties sharing a position.
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

// ---- Rendering --------------------------------------------------------------

function badgeFor(s) {
  if (s.unknown)
    return `<span class="badge out" title="Team name not found in results — check spelling in participants.json">?</span>`;
  if (s.stage === "winner") return `<span class="badge win">Champion</span>`;
  if (s.stage === "runner-up") return `<span class="badge ru">Runner-up</span>`;
  return "";
}

function teamCell(s) {
  return `
    <div class="team-cell">
      <span class="team-name">${escapeHtml(s.teamName)} ${badgeFor(s)}</span>
      <span class="team-stage">${STAGE_LABEL[s.stage] || s.stage} · <b class="team-pts">${s.points}</b>pt${s.points === 1 ? "" : "s"}${s.overridden ? " *" : ""}</span>
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function render(rows) {
  const table = document.getElementById("leaderboard");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr class="rank-${r.rank}">
        <td class="col-rank">${r.rank}</td>
        <td class="col-name"><span class="player-name">${escapeHtml(r.name)}</span></td>
        <td class="col-team">${teamCell(r.slots[0])}</td>
        <td class="col-team">${teamCell(r.slots[1])}</td>
        <td class="col-team">${teamCell(r.slots[2])}</td>
        <td class="col-total">${r.total}</td>
      </tr>`
    )
    .join("");
  table.hidden = false;
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
    overrides = {}; // optional file
  }

  let stages = {};
  let sourceLabel = "";
  try {
    const live = await fetchJson(CONFIG.liveDataUrl);
    stages = deriveStages(live);
    sourceLabel = "live results (openfootball)";
    setStatus("Live results loaded. Updated " + new Date().toLocaleString(), "ok");
  } catch (e) {
    console.error(e);
    sourceLabel = "manual overrides only (live feed unreachable)";
    setStatus(
      "Live results feed unreachable — showing manual results from results-overrides.json.",
      "error"
    );
  }

  stages = applyOverrides(stages, overrides);
  const rows = scorePlayers(participants, stages);
  render(rows);

  document.getElementById("source-note").innerHTML =
    `Data source: ${sourceLabel}. ` +
    `Results: <a href="https://github.com/openfootball/worldcup.json">openfootball/worldcup.json</a>. ` +
    `* = manually set in results-overrides.json.`;
}

if (typeof document !== "undefined") {
  main();
}

// Exposed for the node test harness (test.js); ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deriveStages, applyOverrides, scorePlayers, STAGE_POINTS, norm };
}
