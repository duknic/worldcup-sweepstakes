/* Node test harness for the scoring logic. Run: node test.js
 * Not part of the deployed site.
 */
const { deriveStages, applyOverrides, scorePlayers, STAGE_POINTS } = require("./app.js");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  expected ${expected}, got ${actual}`); }
}

// Minimal but complete tournament: 4 teams in a group (only 2 groups worth kept
// small), then a full knockout ladder using openfootball-style score fields.
const data = {
  matches: [
    // Group A – establishes the "real teams" set
    { round: "Matchday 1", group: "Group A", team1: "Alpha", team2: "Bravo", score1: 2, score2: 0 },
    { round: "Matchday 1", group: "Group A", team1: "Charlie", team2: "Delta", score1: 1, score2: 1 },
    // Group B
    { round: "Matchday 1", group: "Group B", team1: "Echo", team2: "Foxtrot", score1: 3, score2: 1 },
    { round: "Matchday 1", group: "Group B", team1: "Golf", team2: "Hotel", score1: 0, score2: 2 },
    // Round of 32 – Bravo loses here (furthest = R32 => 2 pts)
    { round: "Round of 32", num: 73, team1: "Alpha", team2: "Bravo", score1: 1, score2: 0 },
    { round: "Round of 32", num: 74, team1: "Charlie", team2: "Delta", score1: 2, score2: 1 },
    { round: "Round of 32", num: 75, team1: "Echo", team2: "Foxtrot", score1: 2, score2: 0 },
    { round: "Round of 32", num: 76, team1: "Golf", team2: "Hotel", score1: 1, score2: 3 },
    // Round of 16 – Charlie loses here (furthest = R16 => 3 pts)
    { round: "Round of 16", num: 89, team1: "Alpha", team2: "Charlie", score1: 2, score2: 1 },
    { round: "Round of 16", num: 90, team1: "Echo", team2: "Hotel", score1: 0, score2: 1 },
    // Quarter-final – Hotel loses here (furthest = QF => 4 pts)
    { round: "Quarter-final", num: 97, team1: "Alpha", team2: "Hotel", score1: 3, score2: 2 },
    // Semi-final – decided by penalties; Echo reaches SF (=> 6 pts)
    { round: "Semi-final", num: 101, team1: "Alpha", team2: "Echo",
      score1: 1, score2: 1, score1p: 4, score2p: 3 },
    // Third-place playoff – both stay at semi-final value (6 pts)
    { round: "Match for third place", team1: "Echo", team2: "Delta", score1: 2, score2: 0 },
    // Final – Alpha wins (12), other finalist runner-up (8). Use a fresh finalist.
    { round: "Final", team1: "Alpha", team2: "India", score1: 2, score2: 1 },
    // India needs to be a "real team" to count, so give it a group match.
    { round: "Matchday 2", group: "Group C", team1: "India", team2: "Juliet", score1: 1, score2: 0 },
  ],
};

const stages = deriveStages(data);

eq(stages["alpha"].points, 12, "Alpha wins final => 12");
eq(stages["alpha"].stage, "winner", "Alpha stage winner");
eq(stages["india"].points, 10, "India loses final => runner-up 10");
eq(stages["echo"].points, 8, "Echo lost SF (on pens) => 8");
eq(stages["delta"].points, 8, "Delta played 3rd-place => semi-final 8");
eq(stages["hotel"].points, 5, "Hotel lost QF => 5");
eq(stages["charlie"].points, 3, "Charlie lost R16 => 3");
eq(stages["bravo"].points, 2, "Bravo lost R32 => 2");
eq(stages["foxtrot"].points, 2, "Foxtrot lost R32 => 2");
eq(stages["juliet"].points, 1, "Juliet out in group => 1");

// Elimination flags.
eq(stages["alpha"].eliminated, false, "Champion Alpha not eliminated");
eq(stages["india"].eliminated, true, "Runner-up India eliminated");
eq(stages["echo"].eliminated, true, "Echo out (lost SF + 3rd place)");
eq(stages["hotel"].eliminated, true, "Hotel out (lost QF)");
eq(stages["juliet"].eliminated, true, "Juliet out (group, knockouts started)");

// Overrides win over derived data.
const withOverride = applyOverrides({ ...stages }, { teamStages: { Juliet: "quarter-final" } });
eq(withOverride["juliet"].points, 5, "Override lifts Juliet to QF => 5");

// Player totals = sum of three teams; ranking + tie handling.
const players = [
  { name: "P1", teams: { favourite: "Alpha", midRange: "Echo", underdog: "Bravo" } }, // 12+8+2 = 22
  { name: "P2", teams: { favourite: "India", midRange: "Hotel", underdog: "Charlie" } }, // 10+5+3 = 18
  { name: "P3", teams: { favourite: "Delta", midRange: "Foxtrot", underdog: "Juliet" } }, // 8+2+1 = 11
  { name: "P4", teams: { favourite: "Bravo", midRange: "Charlie", underdog: "Delta" } }, // 2+3+8 = 13
  { name: "P5", teams: { favourite: "Nonexistent", midRange: "Juliet", underdog: "Juliet" } }, // 1+1+1 = 3
];
const rows = scorePlayers(players, stages);
eq(rows[0].name, "P1", "P1 top of leaderboard");
eq(rows[0].total, 22, "P1 total 22");
eq(rows[1].total, 18, "second place total 18");
eq(rows[0].rank, 1, "rank 1");
eq(rows[1].rank, 2, "rank 2");
eq(rows[4].total, 3, "unknown + two group teams => 1+1+1 = 3");

// Frontier-based elimination: bracket drawn but NO scores yet. Teams that
// didn't make the latest resolved round are out even without results.
const bracketOnly = { matches: [
  { round: "Matchday 1", group: "Group A", team1: "Aa", team2: "Bb" },
  { round: "Matchday 1", group: "Group A", team1: "Cc", team2: "Dd" },
  { round: "Round of 32", num: 73, team1: "Aa", team2: "Cc" },   // Bb, Dd missed knockouts
  { round: "Round of 16", num: 89, team1: "Aa", team2: "Ee" },   // Cc missed R16 => out
  { round: "Matchday 1", group: "Group B", team1: "Ee", team2: "Ff" },
]};
const bo = deriveStages(bracketOnly);
eq(bo["aa"].eliminated, false, "Aa reached R16 frontier => in (no scores)");
eq(bo["aa"].stage, "round-of-16", "Aa furthest R16");
eq(bo["cc"].eliminated, true, "Cc stuck at R32 below frontier => out");
eq(bo["bb"].eliminated, true, "Bb never left group => out");
eq(bo["ff"].eliminated, true, "Ff group-only => out");

// New openfootball 2026 score format: { score: { ft:[a,b], et:[...], pen:[...] } }.
const newFmt = { matches: [
  { round: "Matchday 1", group: "Group A", team1: "Xx", team2: "Yy", score: { ft: [2, 0], ht: [1, 0] } },
  { round: "Matchday 1", group: "Group A", team1: "Zz", team2: "Ww", score: { ft: [0, 0], ht: [0, 0] } },
  // R32: Xx beats Yy on the day
  { round: "Round of 32", num: 73, team1: "Xx", team2: "Yy", score: { ft: [1, 0], ht: [0, 0] } },
  // R32: Zz beats Ww on penalties after a draw
  { round: "Round of 32", num: 74, team1: "Zz", team2: "Ww", score: { ft: [1, 1], ht: [0, 1] }, },
  // R16: Xx vs Zz, Zz wins after extra time
  { round: "Round of 16", num: 89, team1: "Xx", team2: "Zz", score: { ft: [1, 1], et: [1, 2] } },
]};
const nf = deriveStages(newFmt);
eq(nf["yy"].eliminated, true, "New-fmt: Yy lost R32 (score.ft) => out");
eq(nf["yy"].points, 2, "New-fmt: Yy R32 => 2");
eq(nf["xx"].eliminated, true, "New-fmt: Xx lost R16 after ET (score.et) => out");
eq(nf["xx"].points, 3, "New-fmt: Xx reached R16 => 3");
eq(nf["zz"].eliminated, false, "New-fmt: Zz won R16, still in");

// Penalties decide via score.pen even when ft is level.
const pens = { matches: [
  { round: "Matchday 1", group: "Group A", team1: "Pp", team2: "Qq", score: { ft: [0, 0] } },
  { round: "Round of 32", num: 73, team1: "Pp", team2: "Qq", score: { ft: [1, 1], pen: [5, 4] } },
  { round: "Round of 16", num: 89, team1: "Pp", team2: "Rr", score: null },
  { round: "Matchday 1", group: "Group B", team1: "Rr", team2: "Ss", score: { ft: [1, 0] } },
]};
const pn = deriveStages(pens);
eq(pn["qq"].eliminated, true, "Pens: Qq lost shootout => out");
eq(pn["pp"].eliminated, false, "Pens: Pp won shootout, reached R16 frontier => in");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
