// The Winter Classic page reads everything about the players and the course
// from the B&B Golf app, so the trip's player list in the app is the only list:
//   the field      tournaments/{id}.players -> players/{id} (name, GHIN index)
//   tees           the trip's days (rounds) -> each player's tee
//   the course     courses/{id} for the days' course, hole by hole
//   the teams      worked out here from the field (proposed until they're set)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

const TRIP = 'oODl7OvXVvlFOYDvB4LT'; // Winter Classic, code WCDREI
const app = initializeApp({ apiKey: 'AIzaSyCkj6gYcGJmZrDELoFV8o7OW3_5YSmY2z0', authDomain: 'golf-tournament-app-e2390.firebaseapp.com', projectId: 'golf-tournament-app-e2390' });
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtIndex = n => (n == null ? '–' : n < 0 ? `+${(-n).toFixed(1)}` : n.toFixed(1));
const FLIGHTS = ['A', 'B', 'C', 'D'];

/** Course handicap as the app works it out: index × slope/113 + (rating − par), to the nearest stroke */
const courseHandicap = (hi, tee) => (hi == null || !tee ? null
  : Math.round(Math.round((hi * tee.slope_rating / 113 + (tee.course_rating - (tee.par_total || 72))) * 10) / 10));

async function load() {
  const trip = (await getDoc(doc(db, 'tournaments', TRIP))).data();
  if (!trip) throw new Error('trip not found');
  const rounds = (await getDocs(collection(db, 'tournaments', TRIP, 'rounds'))).docs
    .map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
  const courseId = rounds.find(r => r.courseId)?.courseId;
  const course = courseId ? (await getDoc(doc(db, 'courses', courseId))).data() : null;
  const players = (await Promise.all((trip.players || []).map(async id => {
    const p = (await getDoc(doc(db, 'players', id))).data();
    return p ? { id, name: `${p.firstName || ''} ${p.lastName || ''}`.trim(), hi: typeof p.handicapIndex === 'number' ? p.handicapIndex : null } : null;
  }))).filter(Boolean);

  // Each player's tee on Day 1 (everyone on the III tees for now)
  const first = rounds[0];
  const teeOf = id => {
    const a = first?.playerAssignments?.[id];
    return a && course ? (course.tees?.[a.teeGender || 'male'] || [])[a.teeIndex ?? 0] : null;
  };
  players.forEach(p => { p.tee = teeOf(p.id); p.ch = courseHandicap(p.hi, p.tee); });
  const mainTee = players.map(p => p.tee).find(Boolean) || course?.tees?.male?.find(t => t.tee_name === 'III');

  showCourse(course, mainTee);
  showField(players);
  showTeams(players);
}

function showCourse(course, tee) {
  if (!course || !tee) return;
  $('course-name').textContent = course.club_name || course.course_name;
  if (course.location?.city) $('course-where').textContent = `${course.location.city}, ${course.location.state === 'FL' ? 'Florida' : course.location.state}`;
  $('st-yards').textContent = (tee.total_yards || 0).toLocaleString();
  $('st-par').textContent = tee.par_total;
  $('st-rating').textContent = tee.course_rating;
  $('st-slope').textContent = tee.slope_rating;
  const holes = tee.holes || [];
  const sum = (from, to, key) => holes.slice(from, to).reduce((s, h) => s + (h[key] || 0), 0);
  const row = (label, key, totals) => `<tr><th scope="row">${label}</th>${holes.slice(0, 9).map(h => `<td>${h[key] ?? ''}</td>`).join('')}<td class="tot">${totals ? sum(0, 9, key) : ''}</td>${holes.slice(9, 18).map(h => `<td>${h[key] ?? ''}</td>`).join('')}<td class="tot">${totals ? sum(9, 18, key) : ''}</td><td class="tot">${totals ? sum(0, 18, key) : ''}</td></tr>`;
  $('holes').innerHTML = `<thead><tr class="head"><th>Hole</th>${[1,2,3,4,5,6,7,8,9].map(n => `<th>${n}</th>`).join('')}<th>Out</th>${[10,11,12,13,14,15,16,17,18].map(n => `<th>${n}</th>`).join('')}<th>In</th><th>Tot</th></tr></thead>
    <tbody>${row('Yards', 'yardage', true)}${row('Par', 'par', true)}${row('Handicap', 'handicap', false)}</tbody>`;
  $('tees').innerHTML = (course.tees?.male || []).map(t =>
    `<span class="tee${t.tee_name === tee.tee_name ? ' ours' : ''}">${esc(t.tee_name)} · ${(t.total_yards || 0).toLocaleString()} yds · ${t.course_rating}/${t.slope_rating}</span>`).join('');
}

/** Lowest index first; four to a flight */
function flightsOf(players) {
  const sorted = [...players].sort((a, b) => (a.hi ?? 99) - (b.hi ?? 99) || a.name.localeCompare(b.name));
  sorted.forEach((p, i) => { p.flight = FLIGHTS[Math.floor(i / 4)] || 'D'; });
  return FLIGHTS.map(f => sorted.filter(p => p.flight === f));
}

function showField(players) {
  const flights = flightsOf(players);
  $('flights').innerHTML = flights.map((list, i) => `<div class="card flight">
      <h3>Flight ${FLIGHTS[i]} <small>${list.length ? `${fmtIndex(list[0].hi)} – ${fmtIndex(list[list.length - 1].hi)}` : ''}</small></h3>
      ${list.map(p => `<div class="player"><span class="nm">${esc(p.name)}</span><span class="hc">${fmtIndex(p.hi)} · <b>${p.ch ?? '–'}</b></span></div>`).join('')}
    </div>`).join('') + `<p class="note" style="grid-column:1/-1;color:var(--ice)">Index · <b style="color:#fff">course handicap</b> (III tees). ${players.length} players.</p>`;
}

// ---------- Proposed teams ----------
// One player per flight on every team, and no two players teammates twice: the
// teams are the lines of the 4×4 grid (flights × places) in three of its four
// "slope" directions over GF(4), so any two lines meet at most once. Every way of
// ordering the players inside flights B, C and D is tried, and the most even
// set of team totals (course handicaps) is kept.
const MUL = [[0, 0, 0, 0], [0, 1, 2, 3], [0, 2, 3, 1], [0, 3, 1, 2]];
const perms4 = (() => { const out = []; const go = (a, rest) => rest.length ? rest.forEach((x, i) => go([...a, x], rest.filter((_, j) => j !== i))) : out.push(a); go([], [0, 1, 2, 3]); return out; })();
const SLOPE_SETS = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];

function proposeTeams(flights) {
  const ch = flights.map(f => f.map(p => p.ch ?? 0));
  const avg = ch.flat().reduce((s, n) => s + n, 0) / 4;
  let best = null;
  for (const pB of perms4) for (const pC of perms4) for (const pD of perms4) {
    const order = [[0, 1, 2, 3], pB, pC, pD];
    for (const slopes of SLOPE_SETS) {
      let lo = Infinity, hi = -Infinity, sq = 0;
      for (const m of slopes) for (let b = 0; b < 4; b++) {
        let s = 0;
        for (let x = 0; x < 4; x++) s += ch[x][order[x][MUL[m][x] ^ b]];
        if (s < lo) lo = s; if (s > hi) hi = s; sq += (s - avg) ** 2;
      }
      const score = (hi - lo) * 1e4 + sq;
      if (!best || score < best.score) best = { score, order, slopes };
    }
  }
  return best.slopes.map(m => [0, 1, 2, 3].map(b => [0, 1, 2, 3].map(x => flights[x][best.order[x][MUL[m][x] ^ b]]))
    .sort((a, b) => a[0].hi - b[0].hi));
}

const DAYS = ['Day 1 · Fri · Best Ball', 'Day 2 · Sat · 30/40', 'Day 3 · Sun · Stableford'];

function showTeams(players) {
  const flights = flightsOf(players);
  if (players.length !== 16 || flights.some(f => f.length !== 4)) {
    $('team-grid').innerHTML = `<div class="loading">Teams are proposed once the field is 16 players (${players.length} now).</div>`;
    return;
  }
  const days = proposeTeams(flights);
  const totals = days.flat().map(t => t.reduce((s, p) => s + (p.ch ?? 0), 0));
  const draw = d => {
    [...$('team-tabs').children].forEach((b, i) => b.setAttribute('aria-selected', String(i === d)));
    $('team-grid').innerHTML = days[d].map((team, i) => {
      const total = team.reduce((s, p) => s + (p.ch ?? 0), 0);
      return `<div class="card team"><h3>Team ${i + 1} <small>Total ${total}</small></h3>
        ${team.map(p => `<div class="member"><span class="fl f${p.flight}">${p.flight}</span><span>${esc(p.name)}</span><span class="ch">${p.ch ?? '–'}</span></div>`).join('')}
      </div>`;
    }).join('');
  };
  $('team-tabs').innerHTML = DAYS.map((label, i) => `<button role="tab" type="button">${label}</button>`).join('');
  [...$('team-tabs').children].forEach((b, i) => b.addEventListener('click', () => draw(i)));
  draw(0);
  $('team-note').textContent = `Team totals (course handicaps) run ${Math.min(...totals)} to ${Math.max(...totals)}. `
    + 'Worked out from the field as it stands, so they can shift while indexes move until November 23.';
}

onAuthStateChanged(auth, user => {
  if (!user) { signInAnonymously(auth).catch(e => console.error(e)); return; }
  load().catch(e => {
    console.error('Live details not loaded:', e);
    ['flights', 'team-grid'].forEach(id => { $(id).innerHTML = '<div class="loading">Couldn\'t reach the app just now. Refresh to try again.</div>'; });
  });
});
