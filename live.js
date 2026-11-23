// The Winter Classic page reads everything about the players and the course
// from the B&B Golf app, so the trip's player list in the app is the only list:
//   the field      tournaments/{id}.players -> players/{id} (names)
//   handicaps      locked November 23: the index below (LOCKED) and each player's
//                  course handicap saved on Day 1 (rounds -> playerAssignments)
//   the course     courses/{id} for the days' course, hole by hole
//   the teams      each day's tee pairings in the app (rounds -> groups)
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

// Handicap indexes as they locked on November 23 (GHIN that morning). They're kept
// here because a few players are also on other trips whose indexes keep following GHIN.
const LOCKED = {
  HVvKttssoxeZucwrBabU: 4.5,  // Ricky Carraher
  '5h10jyCYkaV8MSGgunw7': 5.0, // Ron Carraher
  uogK7P75rlPhEtj0STDN: 5.3,  // Bill Gomez
  NeyiBIiUfQow3T9R3t1l: 7.6,  // Bret Bologna
  MhVvRwqjFDQk261EAZkV: 8.5,  // Dan Sherman
  XhFeBDsYUjcmGqLjIB01: 9.0,  // Kevin Livesay
  Ns61OAOb7CqJB1l4Natj: 9.5,  // John Ziolkowski
  WZ4hEukIl2Uxg8VpLI22: 9.9,  // Doug Ehens
  eft3Hy1J68Z0boKDyCTi: 11.2, // Ruben Hernandez
  '5gHl12dhldsTx5giPRnB': 11.3, // Kevin Sullivan
  '40JaINZy6aNcZNPjG7nO': 12.2, // Hunter Carmichael
  cpExV97QFdlMnOB3fpPF: 13.1, // Dan Darlson
  ozDRz3Jzfh1E3IanxcsH: 14.8, // Ray Govert
  pwJLZUSoWUmlGGUP3sMs: 16.8, // Jeff Gallisdorfer
  rfmEwHxhguxQCSeKOf68: 18.7, // John Supan
  '2f44zJHuc80yw9JYSaRO': 22.7, // Cihan Ozdemir
};

/** Course handicap: index × slope/113 + (rating − par), to the nearest stroke (only if the app has none saved) */
const courseHandicap = (hi, tee) => (hi == null || !tee ? null
  : Math.round(hi * tee.slope_rating / 113 + (tee.course_rating - (tee.par_total || 72))));

const DAYS = ['Day 1 · Fri · Stableford', 'Day 2 · Sat · 30/40', 'Day 3 · Sun · Best Ball 3-3-2'];
const fmtTime = t => String(t || '').replace(/\s*AM$/i, ' am').replace(/\s*PM$/i, ' pm');

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
  const first = rounds[0];
  const teeOf = id => {
    const a = first?.playerAssignments?.[id];
    return a && course ? (course.tees?.[a.teeGender || 'male'] || [])[a.teeIndex ?? 0] : null;
  };
  const players = (trip.players || []).map(id => {
    const p = found[NAME(`players/${id}`)];
    if (!p) return null;
    const hi = LOCKED[id] ?? (typeof p.handicapIndex === 'number' ? p.handicapIndex : null);
    const saved = first?.playerAssignments?.[id]?.courseHandicap;
    return { id, name: `${p.firstName || ''} ${p.lastName || ''}`.trim(), hi, ch: typeof saved === 'number' ? Math.round(saved) : courseHandicap(hi, teeOf(id)) };
  }).filter(Boolean);
  // The teams: each day's tee pairings, in order
  const days = rounds.slice(0, 3).map(r => [...(r.groups || [])]
    .sort((a, b) => (a.groupNumber || 0) - (b.groupNumber || 0))
    .map((g, i) => ({ name: g.name || `Team ${i + 1}`, teeTime: g.teeTime || '', players: g.players || [] })));
  const mainTee = players.map(p => teeOf(p.id)).find(Boolean) || course?.tees?.male?.find(t => t.tee_name === 'II');
  show({ course, mainTee, players, days });
  store.set('wc-field2', { course, mainTee, players, days });
}

function show({ course, mainTee, players, days }) {
  showCourse(course, mainTee);
  showField(players);
  showTeams(players, days || []);
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
    </div>`).join('');
}

// ---------- The teams (each day's tee pairings in the app) ----------
let pick = null; // the player picked in "Find your teams"
try { pick = localStorage.getItem('wc-me'); } catch (e) { /* private mode */ }

function showTeams(players, days) {
  flightsOf(players); // sets each player's flight
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  if (!days.length || days.some(d => !d.length)) {
    $('team-grid').innerHTML = '<div class="loading">The teams are being loaded into the app.</div>';
    $('team-tabs').innerHTML = ''; $('team-find').innerHTML = ''; $('team-note').textContent = '';
    return;
  }
  const total = team => team.players.reduce((s, id) => s + (byId[id]?.ch ?? 0), 0);
  let day = 0;
  const draw = () => {
    [...$('team-tabs').children].forEach((b, i) => b.setAttribute('aria-selected', String(i === day)));
    $('team-grid').innerHTML = days[day].map(team => `<div class="card team${team.players.includes(pick) ? ' mine' : ''}">
        <h3>${esc(team.name)} <small>${team.teeTime ? `${esc(fmtTime(team.teeTime))} · ` : ''}Total ${total(team)}</small></h3>
        ${team.players.map(id => byId[id]).filter(Boolean).sort((a, b) => FLIGHTS.indexOf(a.flight) - FLIGHTS.indexOf(b.flight))
          .map(p => `<div class="member${p.id === pick ? ' me' : ''}"><span class="fl f${p.flight}">${p.flight}</span><span>${esc(p.name)}</span><span class="ch">${p.ch ?? '–'}</span></div>`).join('')}
      </div>`).join('');
  };
  const drawMine = () => {
    const me = byId[pick];
    if (!me) { $('team-mine').innerHTML = ''; return; }
    $('team-mine').innerHTML = days.map((d, i) => {
      const team = d.find(t => t.players.includes(me.id));
      if (!team) return '';
      const mates = team.players.filter(id => id !== me.id).map(id => byId[id]?.name).filter(Boolean);
      return `<li><b>${esc(DAYS[i])}</b> · ${esc(team.name)}${team.teeTime ? `, ${esc(fmtTime(team.teeTime))}` : ''}<br>with ${esc(mates.join(', '))}</li>`;
    }).join('');
  };
  $('team-tabs').innerHTML = DAYS.map(label => `<button role="tab" type="button">${label}</button>`).join('');
  [...$('team-tabs').children].forEach((b, i) => b.addEventListener('click', () => { day = i; draw(); }));
  const names = [...players].sort((a, b) => a.name.localeCompare(b.name));
  $('team-find').innerHTML = `<label for="team-me">Find your teams</label>
    <select id="team-me"><option value="">Pick your name</option>${names.map(p => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <ul id="team-mine"></ul>`;
  $('team-me').addEventListener('change', e => {
    pick = e.target.value || null;
    try { pick ? localStorage.setItem('wc-me', pick) : localStorage.removeItem('wc-me'); } catch (err) { /* private mode */ }
    drawMine(); draw();
  });
  draw(); drawMine();
  const totals = days.flat().map(total);
  $('team-note').textContent = `Teams and handicaps are locked (November 23) and match the app. Team totals (course handicaps) run ${Math.min(...totals)} to ${Math.max(...totals)}.`;
}

// What this phone saw last time, straight away; then the latest from the app
const last = store.get('wc-field2');
if (last?.players?.length) { try { show(last); } catch (e) { /* redrawn below */ } }
load().catch(e => {
  console.error('Live details not loaded:', e);
  if (!last?.players?.length) {
    ['flights', 'team-grid'].forEach(id => { $(id).innerHTML = '<div class="loading">Couldn\'t reach the app just now. Refresh to try again.</div>'; });
  }
});
