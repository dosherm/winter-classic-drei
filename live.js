// The Winter Classic page reads everything about the players and the course
// from the B&B Golf app, so the trip's player list in the app is the only list:
//   the field      tournaments/{id}.players -> players/{id} (name, GHIN index)
//   tees           the trip's days (rounds) -> each player's tee
//   the course     courses/{id} for the days' course, hole by hole
//   the teams      worked out here from the field (proposed until they're set)
//
// It talks to the database directly (Firestore's REST API) rather than loading
// the Firebase toolkit: four small requests instead of a megabyte of code and a
// few dozen round trips, which matters on a phone. The last field it showed is
// kept on the phone, so a repeat visit shows it at once and then refreshes it.

const TRIP = 'oODl7OvXVvlFOYDvB4LT'; // Winter Classic, code WCDREI
const KEY = 'AIzaSyCkj6gYcGJmZrDELoFV8o7OW3_5YSmY2z0';
const DOCS = 'https://firestore.googleapis.com/v1/projects/golf-tournament-app-e2390/databases/(default)/documents';
const NAME = path => `projects/golf-tournament-app-e2390/databases/(default)/documents/${path}`;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

/** An anonymous sign-in (the database only answers signed-in visitors), kept on the phone and renewed when it runs out */
async function idToken() {
  const saved = store.get('wc-auth');
  if (saved?.idToken && saved.expires > Date.now() + 60000) return saved.idToken;
  let r;
  if (saved?.refreshToken) {
    r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(saved.refreshToken)}`,
    });
    if (r.ok) {
      const j = await r.json();
      store.set('wc-auth', { idToken: j.id_token, refreshToken: j.refresh_token, expires: Date.now() + j.expires_in * 1000 });
      return j.id_token;
    }
  }
  r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`sign-in ${r.status}`);
  const j = await r.json();
  store.set('wc-auth', { idToken: j.idToken, refreshToken: j.refreshToken, expires: Date.now() + j.expiresIn * 1000 });
  return j.idToken;
}

/** Firestore's typed values ({ stringValue: 'x' }, { mapValue: { fields } }...) as plain values */
function plain(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) return fields(v.mapValue.fields);
  return null;
}
const fields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, plain(v)]));
const idOf = name => name.split('/').pop();

async function api(token, path, body) {
  const r = await fetch(`${DOCS}${path}`, body
    ? { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtIndex = n => (n == null ? '–' : n < 0 ? `+${(-n).toFixed(1)}` : n.toFixed(1));
const FLIGHTS = ['A', 'B', 'C', 'D'];

/** Course handicap as the app works it out: index × slope/113 + (rating − par), to the nearest stroke */
const courseHandicap = (hi, tee) => (hi == null || !tee ? null
  : Math.round(Math.round((hi * tee.slope_rating / 113 + (tee.course_rating - (tee.par_total || 72))) * 10) / 10));

async function load() {
  const token = await idToken();
  // The trip and its days together, then the course and every player in one go
  const [tripDoc, roundList] = await Promise.all([
    api(token, `/tournaments/${TRIP}`),
    api(token, `/tournaments/${TRIP}/rounds?pageSize=50`),
  ]);
  const trip = fields(tripDoc.fields);
  const rounds = (roundList.documents || []).map(d => ({ id: idOf(d.name), ...fields(d.fields) }))
    .sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
  const courseId = rounds.find(r => r.courseId)?.courseId;
  const wanted = [...(courseId ? [NAME(`courses/${courseId}`)] : []), ...(trip.players || []).map(id => NAME(`players/${id}`))];
  const got = wanted.length ? await api(token, ':batchGet', { documents: wanted }) : [];
  const found = Object.fromEntries(got.filter(x => x.found).map(x => [x.found.name, fields(x.found.fields)]));
  const course = courseId ? found[NAME(`courses/${courseId}`)] || null : null;
  const players = (trip.players || []).map(id => {
    const p = found[NAME(`players/${id}`)];
    return p ? { id, name: `${p.firstName || ''} ${p.lastName || ''}`.trim(), hi: typeof p.handicapIndex === 'number' ? p.handicapIndex : null } : null;
  }).filter(Boolean);

  // Each player's tee on Day 1 (everyone on the III tees for now)
  const first = rounds[0];
  const teeOf = id => {
    const a = first?.playerAssignments?.[id];
    return a && course ? (course.tees?.[a.teeGender || 'male'] || [])[a.teeIndex ?? 0] : null;
  };
  players.forEach(p => { p.tee = teeOf(p.id); p.ch = courseHandicap(p.hi, p.tee); });
  const mainTee = players.map(p => p.tee).find(Boolean) || course?.tees?.male?.find(t => t.tee_name === 'III');
  show({ course, mainTee, players });
  store.set('wc-field', { course, mainTee, players });
}

function show({ course, mainTee, players }) {
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

// What this phone saw last time, straight away; then the latest from the app
const last = store.get('wc-field');
if (last?.players?.length) { try { show(last); } catch (e) { /* redrawn below */ } }
load().catch(e => {
  console.error('Live details not loaded:', e);
  if (!last?.players?.length) {
    ['flights', 'team-grid'].forEach(id => { $(id).innerHTML = '<div class="loading">Couldn\'t reach the app just now. Refresh to try again.</div>'; });
  }
});
