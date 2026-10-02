import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- state ---------- */
const S = {
  teachers: {}, students: {}, packages: {}, profiles: [], payments: [],
  settings: { schoolName: 'Studio Desk', term: '', lowThreshold: 2 },
  session: null, me: null, loaded: false, authMode: 'signin', recovery: false,
  tab: 'today', date: null, weekTeacher: null,
  pkgFilter: { teacher: 'all', state: 'active', q: '' }, payFilter: { q: '', method: 'all', status: 'all' }, hist: { rows: [], actor: 'all', area: 'all', q: '', from: '', to: '', done: false, loading: false }, stuFilter: { q: '', form: 'all', teacher: 'all' },
};
let drawer = null;
let modal = null;
const isAdmin = () => S.me?.role === 'admin';
const myTeacher = () => S.me?.teacher_id || null;
const canEditSlots = tid => isAdmin() || tid === myTeacher();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ST = {
  present: { label: 'Present', seg: 'Present', counts: true },
  absent: { label: 'Absent, makeup owed', seg: 'Absent', counts: false, owes: true },
  noshow: { label: 'No-show (charged)', seg: 'No-show', counts: true },
  cancelled: { label: 'Teacher cancelled, makeup owed', seg: 'Cancelled', counts: false, owes: true },
  makeup: { label: 'Makeup lesson', seg: 'Makeup', counts: true },
};
const KINDS = { semester: 'Semester', monthly: 'Monthly', trial: 'Trial', custom: 'Custom' };
const PAY = { paid: ['Paid', 'ok'], partial: ['Part paid', 'warn'], unpaid: ['Not paid', 'bad'] };
const FORM = { none: ['No form', 'bad'], sent: ['Sent, not signed', 'warn'], signed: ['Signed', 'ok'] };
const ROLES = { admin: 'Super admin (full access)', teacher: 'Teacher (own students only)', pending: 'Waiting for approval' };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kwToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtD = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(new Date(d + 'T12:00:00Z')) : '';
const chipD = d => fmtD(d, { day: 'numeric', month: 'short' });
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toT = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const fmtT = t => { const m = typeof t === 'number' ? t : toMin(t); let h = Math.floor(m / 60); const mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + String(mm).padStart(2, '0') + ' ' + ap; };
const fmtTs = t => { const m = typeof t === 'number' ? t : toMin(t); const h = Math.floor(m / 60) % 12 || 12; return h + ':' + String(m % 60).padStart(2, '0'); };
const slug = s => (s || 'x').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const rid = () => Math.random().toString(36).slice(2, 7);
const sname = id => S.students[id]?.name || 'Student';
const tname = id => S.teachers[id]?.name || 'No teacher';
const tcolor = id => S.teachers[id]?.color || '#778';
const teacherIds = () => Object.keys(S.teachers).sort((a, b) => (S.teachers[a].order ?? 99) - (S.teachers[b].order ?? 99) || tname(a).localeCompare(tname(b)));
const studentIds = incArch => Object.keys(S.students).filter(id => incArch || !S.students[id].archived).sort((a, b) => sname(a).localeCompare(sname(b)));
const slotsOf = tid => S.teachers[tid]?.slots || [];
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }

function stats(p) {
  const log = p.log || []; let used = 0, owes = 0, mk = 0; const c = { present: 0, absent: 0, noshow: 0, cancelled: 0, makeup: 0 };
  for (const e of log) { c[e.s] = (c[e.s] || 0) + 1; if (ST[e.s]?.counts) used++; if (ST[e.s]?.owes) owes++; if (e.s === 'makeup') mk++; }
  const owed = Math.max(0, owes - mk); const total = Number(p.sessions) || 0; const left = total - used;
  const th = Number(S.settings.lowThreshold ?? 2);
  let state = 'active'; if (p.closed) state = 'closed'; else if (left <= 0) state = 'finished'; else if (left <= th) state = 'low';
  const last = log.length ? log.map(e => e.d).sort().at(-1) : null;
  const ended = !p.closed && !!p.end && p.end < kwToday();
  const paidSum = S.payments.filter(x => x.package_id === p.id && x.status === 'paid').reduce((a, x) => a + Number(x.amount), 0);
  return { used, owed, left, total, c, state, last, ended, paidSum };
}
const pkgList = () => Object.entries(S.packages).map(([id, p]) => ({ id, ...p }));
const pairPkgs = (sid, tid) => pkgList().filter(p => p.studentId === sid && p.teacherId === tid);
function pkgForDate(sid, tid, date) {
  const all = pairPkgs(sid, tid);
  const hit = all.find(p => (p.log || []).some(e => e.d === date)); if (hit) return hit;
  const open = all.filter(p => !p.closed).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return open.find(p => stats(p).left > 0) || open.at(-1) || null;
}
const entryFor = (p, date) => p ? (p.log || []).find(e => e.d === date) : null;
const overlaps = (a, b) => a.day === b.day && toMin(a.start) < toMin(b.start) + b.dur && toMin(b.start) < toMin(a.start) + a.dur;
function studentSlots(sid) { const out = []; for (const t of teacherIds()) for (const s of slotsOf(t)) if (s.studentId === sid) out.push({ ...s, teacherId: t }); return out.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start)); }
const slotLabel = s => s.studentId ? sname(s.studentId) : (s.label || 'Reserved');
function conflictsFor(tid, slot) {
  const res = { teacher: [], student: [] };
  for (const s of slotsOf(tid)) if (s.id !== slot.id && overlaps(s, slot)) res.teacher.push(s);
  if (slot.studentId) for (const t of teacherIds()) for (const s of slotsOf(t)) if (s.id !== slot.id && s.studentId === slot.studentId && overlaps(s, slot)) res.student.push({ ...s, teacherId: t });
  return res;
}

/* ---------- data: load + realtime ---------- */
async function loadAll() {
  const q = await Promise.all([
    sb.from('teachers').select('*'), sb.from('students').select('*'), sb.from('packages').select('*'),
    sb.from('lessons').select('id,package_id,lesson_date,status,note'), sb.from('slots').select('*'),
    sb.from('settings').select('*').maybeSingle(),
    isAdmin() ? sb.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] }),
    isAdmin() ? sb.from('payments').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const bad = q.find(r => r.error); if (bad) { console.error(bad.error); toast('Could not load the studio data. Refresh to try again.'); return; }
  const [t, s, p, l, sl, st, pr, pay] = q.map(r => r.data);
  const teachers = {};
  for (const r of t) teachers[r.id] = { name: r.name, subjects: r.subjects, color: r.color, notes: r.notes, order: r.sort_order, slots: [] };
  for (const r of sl) teachers[r.teacher_id]?.slots.push({ id: r.id, day: r.day, start: r.start_time, dur: r.dur, studentId: r.student_id, label: r.label, status: r.status, note: r.note });
  const students = {};
  for (const r of s) students[r.id] = { name: r.name, guardian: r.guardian, phone: r.phone, regForm: r.reg_form, notes: r.notes, archived: r.archived };
  const packages = {};
  for (const r of p) packages[r.id] = { studentId: r.student_id, teacherId: r.teacher_id, subject: r.subject, kind: r.kind, sessions: r.sessions, perWeek: r.per_week, start: r.start_date, end: r.end_date, term: r.term, payment: r.payment, paidNote: r.paid_note, price: r.price, notes: r.notes, closed: r.closed, log: [] };
  for (const r of l) packages[r.package_id]?.log.push({ id: r.id, d: r.lesson_date, s: r.status, n: r.note });
  for (const k in packages) packages[k].log.sort((a, b) => a.d.localeCompare(b.d));
  Object.assign(S, { teachers, students, packages, profiles: pr || [], payments: pay || [], loaded: true });
  if (st) S.settings = { schoolName: st.school_name, term: st.term, lowThreshold: st.low_threshold };
  render();
}
let reloadTimer = null; let channel = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { loadAll(); if (S.tab === 'history' && isAdmin()) loadHistory(true); if (tl.key && drawer && (drawer.type === 'student' || drawer.type === 'package') && isAdmin()) { const [k, i] = tl.key.split('|'); loadTimeline(k, i); } }, 350); };
function subscribe() {
  if (channel) return;
  channel = sb.channel('studio').on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload).subscribe();
}

/* ---------- writes ---------- */
async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) { console.error(error); toast(error.code === '42501' || /row-level security/i.test(error.message) ? 'You do not have permission to make this change.' : error.code === '23505' ? 'That already exists.' : error.code === '23503' ? 'This is still used elsewhere. Remove those records first.' : 'Could not save. Check your connection and try again.'); await loadAll(); throw error; }
  if (okMsg) toast(okMsg);
  await loadAll();
}
const pkgCols = { teacherId: 'teacher_id', studentId: 'student_id', subject: 'subject', kind: 'kind', sessions: 'sessions', perWeek: 'per_week', start: 'start_date', end: 'end_date', term: 'term', payment: 'payment', paidNote: 'paid_note', price: 'price', notes: 'notes', closed: 'closed' };
const toRow = (patch, map) => { const o = {}; for (const k in patch) if (map[k]) o[map[k]] = patch[k] === '' && (k === 'start' || k === 'end') ? null : patch[k]; return o; };
const savePkg = (id, patch, msg) => run(sb.from('packages').update(toRow(patch, pkgCols)).eq('id', id), msg);
async function setLog(pid, date, status, note) {
  const e = entryFor(S.packages[pid], date);
  if (status == null) { if (e) await run(sb.from('lessons').delete().eq('id', e.id)); return; }
  if (e) return run(sb.from('lessons').update(note != null ? { status, note } : { status }).eq('id', e.id));
  return run(sb.from('lessons').insert({ package_id: pid, lesson_date: date, status, note: note || '' }));
}
const slotRow = (tid, s) => ({ id: s.id, teacher_id: tid, day: s.day, start_time: s.start, dur: s.dur, student_id: s.studentId, label: s.label, status: s.status, note: s.note });
const stuCols = { name: 'name', guardian: 'guardian', phone: 'phone', regForm: 'reg_form', notes: 'notes', archived: 'archived' };

/* ---------- auth ---------- */
async function loadMe() {
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', S.session.user.id).maybeSingle();
  if (error) console.error(error);
  S.me = data || { role: 'pending', email: S.session.user.email };
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') S.recovery = true;
  const changed = (S.session?.user?.id || null) !== (session?.user?.id || null);
  S.session = session;
  if (changed || event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY') setTimeout(boot, 0);
});
async function boot() {
  if (!S.session) { S.me = null; S.loaded = false; render(); return; }
  await loadMe();
  if (S.me.role === 'pending') { render(); return; }
  if (!isAdmin() && ['setup', 'history', 'payments'].includes(S.tab)) S.tab = 'today';
  await loadAll(); subscribe();
}
function renderAuth() {
  const m = S.authMode;
  const title = S.recovery ? 'Choose a new password' : m === 'signup' ? 'Create your account' : m === 'reset' ? 'Reset your password' : 'Sign in';
  $('#view').innerHTML = `<div class="auth"><form class="card" id="authForm" novalidate>
    <img class="logo on-light" src="/brand/aria-gold@2x.png" alt="Aria Music Academy"><img class="logo on-dark" src="/brand/aria-gold@2x.png" alt="" aria-hidden="true">
    <div class="rule"><i></i></div>
    <h2>${title}</h2>
    ${S.recovery ? '' : `<label class="f">Email<input type="email" id="aEmail" autocomplete="email" required></label>`}
    ${m === 'reset' && !S.recovery ? '' : `<label class="f">${S.recovery ? 'New password' : 'Password'}<input type="password" id="aPass" autocomplete="${m === 'signin' && !S.recovery ? 'current-password' : 'new-password'}" minlength="8" required></label>`}
    <div id="aMsg" class="small"></div>
    <button class="btn primary" type="submit" style="justify-content:center">${S.recovery ? 'Save password' : m === 'signup' ? 'Create account' : m === 'reset' ? 'Email me a reset link' : 'Sign in'}</button>
    ${S.recovery ? '' : `<div class="links">${m === 'signin' ? '<button type="button" class="linkbtn" data-am="signup">Create an account</button><button type="button" class="linkbtn" data-am="reset">Forgot password?</button>' : '<button type="button" class="linkbtn" data-am="signin">Back to sign in</button>'}</div>`}
    ${m === 'signup' ? '<p class="small muted" style="margin:0">New accounts wait for a super admin to approve them.</p>' : ''}
  </form></div>`;
  document.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { S.authMode = b.dataset.am; render(); });
  const msg = (t, bad) => { $('#aMsg').innerHTML = `<div class="${bad ? 'badbox' : 'infobox'}">${esc(t)}</div>`; };
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#aEmail')?.value.trim(); const pass = $('#aPass')?.value || '';
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (S.recovery) {
        if (pass.length < 8) return msg('Use at least 8 characters.', true);
        const { error } = await sb.auth.updateUser({ password: pass }); if (error) return msg(error.message, true);
        S.recovery = false; toast('Password saved'); boot(); return;
      }
      if (!email) return msg('Enter your email.', true);
      if (m === 'reset') { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); return error ? msg(error.message, true) : msg('If that email has an account, a reset link is on its way.'); }
      if (pass.length < 8) return msg('Use at least 8 characters for the password.', true);
      if (m === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin } });
        if (error) return msg(error.message, true);
        if (!data.session) return msg('Check your email and click the confirmation link, then sign in here.');
        return;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) return msg(error.message === 'Invalid login credentials' ? 'Email or password is wrong.' : error.message, true);
      sb.rpc('log_event', { p_action: 'SIGN_IN', p_detail: { device: navigator.userAgent.slice(0, 160) } }).then(() => {}, () => {});
    } finally { btn.disabled = false; }
  };
}

/* ---------- rendering root ---------- */
function setTab(t) { S.tab = t; if (t === 'history') S.hist.rows = []; try { localStorage.setItem('sd-tab', t); } catch (e) { /* ignore */ } render(); window.scrollTo(0, 0); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
function renderChrome() {
  const inApp = !!(S.session && S.me && S.me.role !== 'pending');
  $('#tabs').hidden = !inApp;
  document.querySelectorAll('#tabs [data-admin]').forEach(b => b.hidden = !isAdmin());
  document.querySelectorAll('#tabs button').forEach(b => { if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#brandName').textContent = (S.settings.schoolName || 'Aria Music Academy') + ' Studio Desk';
  document.title = 'Studio Desk · ' + (S.settings.schoolName || 'Aria Music Academy');
  $('#brandTerm').textContent = inApp ? (S.settings.term || '') : '';
  const w = $('#whoMe'); w.hidden = !S.session;
  if (S.session) w.innerHTML = `<span title="${esc(S.session.user.email)}">${esc(S.me ? (S.me.role === 'admin' ? 'Super admin' : S.me.role === 'teacher' && myTeacher() ? tname(myTeacher()) : S.session.user.email) : S.session.user.email)}</span><button class="btn sm ghost" id="signOut" title="Signed in as ${esc(S.session.user.email)}">Sign out</button>`;
  if (S.session) $('#signOut').onclick = async () => { await sb.rpc('log_event', { p_action: 'SIGN_OUT' }).then(() => {}, () => {}); await sb.auth.signOut(); if (channel) { sb.removeChannel(channel); channel = null; } closeOverlay(); };
}
function render() {
  renderChrome();
  const v = $('#view');
  if (!S.session || S.recovery) { renderAuth(); return; }
  if (!S.me) { v.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (S.me.role === 'pending') { v.innerHTML = `<div class="auth"><div class="card"><h2>Almost there</h2><p style="margin:0">Your account (${esc(S.session.user.email)}) is waiting for the studio admin to approve it. Ask a super admin to open Setup → People and give you access.</p><button class="btn" id="recheck">Check again</button></div></div>`; $('#recheck').onclick = boot; return; }
  if (S.me.role === 'teacher' && !myTeacher()) { v.innerHTML = `<div class="card empty"><h2>Not linked to a teacher yet</h2><p>Ask a super admin to link your account to your teacher name in Setup → People.</p></div>`; return; }
  if (!S.loaded) { v.innerHTML = '<div class="empty">Loading the studio…</div>'; return; }
  if (S.tab === 'setup' && !isAdmin()) S.tab = 'today';
  if (S.tab === 'history' && !isAdmin()) S.tab = 'today';
  if (S.tab === 'payments' && !isAdmin()) S.tab = 'today';
  ({ today: renderToday, week: renderWeek, packages: renderPackages, students: renderStudents, payments: renderPayments, history: renderHistory, setup: renderSetup })[S.tab]();
  renderOverlay(false);
}

/* ---------- TODAY ---------- */
function attention() {
  const today = kwToday(); const items = []; const pk = pkgList();
  const fin = [], low = [], owed = [], unpaid = [], over = [];
  for (const p of pk) {
    if (p.closed) continue; const s = stats(p);
    if (s.used > s.total) over.push([p, s]); else if (s.state === 'finished') fin.push([p, s]); else if (s.state === 'low') low.push([p, s]);
    if (s.owed > 0) owed.push([p, s]); if (p.payment && p.payment !== 'paid') unpaid.push([p, s]);
  }
  const pk2 = (arr, fn) => arr.sort((a, b) => sname(a[0].studentId).localeCompare(sname(b[0].studentId))).map(([p, s]) => `<li><a data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a> · ${esc(tname(p.teacherId))} · ${fn(p, s)}</li>`).join('');
  const unmarked = [];
  for (const t of teacherIds()) for (const sl of slotsOf(t)) {
    if (!sl.studentId || sl.status !== 'confirmed') continue;
    for (let i = 14; i >= 1; i--) {
      const d = addDays(today, -i); if (wd(d) !== sl.day) continue;
      const all = pairPkgs(sl.studentId, t); if (!all.length) continue;
      const started = all.some(p => p.start && p.start <= d && !(p.closed && stats(p).last && stats(p).last < d)); if (!started) continue;
      if (all.some(p => entryFor(p, d))) continue;
      unmarked.push({ d, t, sid: sl.studentId, start: sl.start });
    }
  }
  unmarked.sort((a, b) => a.d.localeCompare(b.d) || a.start.localeCompare(b.start));
  const noPkg = [], noSlot = [];
  for (const t of teacherIds()) for (const sl of slotsOf(t)) if (sl.studentId && sl.status !== 'blocked' && !pairPkgs(sl.studentId, t).some(p => !p.closed)) noPkg.push([sl, t]);
  for (const p of pk) if (!p.closed && !slotsOf(p.teacherId).some(sl => sl.studentId === p.studentId)) noSlot.push(p);
  const endedL = [], endingL = []; const soon = addDays(today, 7);
  for (const p of pk) { if (p.closed || !p.end) continue; const s = stats(p); if (p.end < today) endedL.push([p, s]); else if (p.end <= soon) endingL.push([p, s]); }
  const tent = []; for (const t of teacherIds()) for (const sl of slotsOf(t)) if (sl.status === 'tentative') tent.push([sl, t]);
  const forms = studentIds().filter(id => S.students[id].regForm !== 'signed');
  const add = (n, tone, title, list) => { if (n) items.push({ n, tone, title, list }); };
  add(over.length, 'bad', 'Used more lessons than they paid for', pk2(over, (p, s) => `${s.used} of ${s.total} used`));
  add(fin.length, 'bad', 'Packages finished, renewal due', pk2(fin, (p, s) => `all ${s.total} used`));
  add(low.length, 'warn', 'Packages nearly finished', pk2(low, (p, s) => `${s.left} left`));
  add(endedL.length, 'bad', 'Package end date has passed', pk2(endedL, (p, s) => `ended ${esc(fmtD(p.end))}${s.left > 0 ? ` with ${s.left} lessons left` : ''}`));
  add(endingL.length, 'warn', 'Packages ending this week', pk2(endingL, p => `ends ${esc(fmtD(p.end))}`));
  add(unmarked.length, 'warn', 'Lessons not marked (last 2 weeks)', unmarked.slice(0, 40).map(u => `<li><a data-goto-date="${u.d}">${esc(fmtD(u.d))}</a> · ${fmtT(u.start)} · ${esc(sname(u.sid))} · ${esc(tname(u.t))}</li>`).join('') + (unmarked.length > 40 ? `<li>and ${unmarked.length - 40} more</li>` : ''));
  add(owed.length, 'vio', 'Makeup lessons owed', pk2(owed, (p, s) => `${s.owed} owed`));
  add(unpaid.length, 'bad', 'Payment outstanding', pk2(unpaid, p => esc(PAY[p.payment]?.[0] || p.payment)));
  add(noPkg.length, 'warn', 'On the timetable with no open package', noPkg.map(([sl, t]) => `<li>${esc(sname(sl.studentId))} · ${esc(tname(t))} · ${DS[sl.day]} ${fmtT(sl.start)}${isAdmin() ? ` <a data-new-pkg="${esc(sl.studentId)}|${esc(t)}">add package</a>` : ''}</li>`).join(''));
  add(noSlot.length, 'blue', 'Open package but no weekly time', noSlot.map(p => `<li><a data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a> · ${esc(tname(p.teacherId))}</li>`).join(''));
  add(tent.length, 'warn', 'Times not confirmed yet', tent.map(([sl, t]) => `<li>${esc(slotLabel(sl))} · ${esc(tname(t))} · ${DS[sl.day]} ${fmtT(sl.start)}</li>`).join(''));
  add(forms.length, 'blue', 'Registration forms not signed', forms.map(id => `<li><a data-open-stu="${esc(id)}">${esc(sname(id))}</a> · ${esc(FORM[S.students[id].regForm]?.[0] || '')}</li>`).join(''));
  return items;
}
function segButtons(pid, d, cur, keys) {
  return `<div class="seg" role="group" aria-label="Attendance">${keys.map(k => `<button data-mark="${esc(pid)}|${d}|${k}" class="${cur === k ? 'on-' + k : ''}" aria-pressed="${cur === k}">${ST[k].seg}</button>`).join('')}</div>`;
}
function renderToday() {
  const d = S.date || (S.date = kwToday()); const w = wd(d); const isToday = d === kwToday();
  let body = ''; let any = false;
  for (const t of teacherIds()) {
    const sl = slotsOf(t).filter(s => s.day === w).sort((a, b) => toMin(a.start) - toMin(b.start));
    const slotStu = new Set(sl.map(s => s.studentId).filter(Boolean));
    const extras = pkgList().filter(p => p.teacherId === t && !slotStu.has(p.studentId) && entryFor(p, d));
    if (!sl.length && !extras.length) continue; any = true;
    let rows = sl.map(s => {
      const end = toMin(s.start) + s.dur;
      if (!s.studentId) return `<div class="lesson blocked"><span class="time">${fmtTs(s.start)}–${fmtTs(end)}</span><span>${esc(s.label || 'Reserved')}${s.status === 'tentative' ? ' · not confirmed' : ''}</span><span></span></div>`;
      const p = pkgForDate(s.studentId, t, d); const e = entryFor(p, d); const st = p ? stats(p) : null;
      const info = p ? `${KINDS[p.kind] || ''} · ${st.used} of ${st.total} used${st.left <= 0 ? ' · <span style="color:var(--bad)">finished</span>' : st.state === 'low' ? ` · <span style="color:var(--warn)">${st.left} left</span>` : ''}${st.owed ? ` · ${st.owed} makeup owed` : ''}` : '<span style="color:var(--bad)">No open package</span>';
      const seg = p ? segButtons(p.id, d, e?.s, ['present', 'absent', 'noshow', 'cancelled']) : (isAdmin() ? `<button class="btn sm" data-new-pkg="${esc(s.studentId)}|${esc(t)}">Add package</button>` : '<span></span>');
      return `<div class="lesson"><span class="time">${fmtTs(s.start)}–${fmtTs(end)}</span><div class="who"><b><a style="color:inherit;cursor:pointer" ${p ? `data-open-pkg="${esc(p.id)}"` : `data-open-stu="${esc(s.studentId)}"`}>${esc(sname(s.studentId))}</a></b>${s.status === 'tentative' ? ' <span class="pill warn">not confirmed</span>' : ''}<span class="small muted">${info}${e?.n ? ` · ${esc(e.n)}` : ''}</span></div>${seg}</div>`;
    }).join('');
    rows += extras.map(p => { const e = entryFor(p, d); const st = stats(p); return `<div class="lesson"><span class="time">extra</span><div class="who"><b><a style="color:inherit;cursor:pointer" data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a></b><span class="small muted">${st.used} of ${st.total} used${e.n ? ` · ${esc(e.n)}` : ''}</span></div>${segButtons(p.id, d, e.s, ['makeup', 'present', 'absent', 'noshow', 'cancelled'])}</div>`; }).join('');
    body += `<section class="tgroup"><h3><span class="dot" style="background:${esc(tcolor(t))}"></span>${esc(tname(t))}</h3><div class="card">${rows}</div></section>`;
  }
  if (!any) body = `<div class="card empty">No lessons on the timetable for ${DAYS[w]}s.<br><span class="small">Use “Log makeup or extra” to record a lesson on this day.</span></div>`;
  const items = attention();
  const attn = items.length ? items.map(it => `<div class="attn-item"><span class="n pill ${it.tone}">${it.n}</span><details><summary>${esc(it.title)}</summary><ul>${it.list}</ul></details></div>`).join('') : '<p class="muted small">Nothing needs attention.</p>';
  $('#view').innerHTML = `
  <div class="bar"><div class="daynav"><span class="big">${isToday ? 'Today' : esc(DAYS[w])}</span><span class="muted">${esc(fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
   <span style="margin-left:auto" class="daynav"><button class="btn sm" data-day="-1" aria-label="Previous day">‹ Prev</button><input type="date" id="daypick" value="${d}" aria-label="Date"><button class="btn sm" data-day="1" aria-label="Next day">Next ›</button>${isToday ? '' : '<button class="btn sm" data-day="0">Today</button>'}<button class="btn primary sm" id="logExtra">Log makeup or extra</button></span></div>
  <div class="layout-today"><div>${body}</div><aside class="card attn"><h3>Needs attention</h3>${attn}</aside></div>`;
  $('#daypick').onchange = e => { if (e.target.value) { S.date = e.target.value; render(); } };
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { const n = +b.dataset.day; S.date = n === 0 ? kwToday() : addDays(S.date, n); render(); });
  $('#logExtra').onclick = () => openModal('extra', { date: d });
}

/* ---------- WEEK ---------- */
function renderWeek() {
  const tids = teacherIds();
  if (!S.weekTeacher || !S.teachers[S.weekTeacher]) S.weekTeacher = myTeacher() && S.teachers[myTeacher()] ? myTeacher() : tids[0];
  const t = S.weekTeacher; const slots = slotsOf(t); const editable = canEditSlots(t);
  if (!t) { $('#view').innerHTML = '<div class="card empty">No teachers yet.</div>'; return; }
  const days = [0, 1, 2, 3, 4, 6].concat(slots.some(s => s.day === 5) ? [5] : []).sort((a, b) => a - b);
  let lo = 14 * 60, hi = 20 * 60; for (const s of slots) { lo = Math.min(lo, toMin(s.start)); hi = Math.max(hi, toMin(s.start) + s.dur); }
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60; const rows = (hi - lo) / 15;
  const conflictIds = new Set();
  for (const s of slots) { const c = conflictsFor(t, s); if (c.teacher.length || c.student.length) conflictIds.add(s.id); }
  let g = '<div class="hd"></div>' + days.map((d, i) => `<div class="hd" style="grid-column:${i + 2};grid-row:1">${DAYS[d]}</div>`).join('');
  for (let r = 0; r < rows; r++) {
    const m = lo + r * 15;
    if (m % 60 === 0) g += `<div class="tm" style="grid-column:1;grid-row:${r + 2}">${fmtT(m).replace(':00', '')}</div>`;
    days.forEach((d, i) => { g += editable ? `<button class="cell${m % 60 === 0 ? ' hr' : ''}" style="grid-column:${i + 2};grid-row:${r + 2}" data-add-slot="${d}|${toT(m)}" aria-label="Add lesson ${DAYS[d]} ${fmtT(m)}"></button>` : `<div class="cell${m % 60 === 0 ? ' hr' : ''}" style="grid-column:${i + 2};grid-row:${r + 2};cursor:default"></div>`; });
  }
  for (const s of slots) {
    const i = days.indexOf(s.day); if (i < 0) continue;
    const r0 = (toMin(s.start) - lo) / 15 + 2; const span = Math.max(1, Math.round(s.dur / 15));
    const cls = ['blk', s.status !== 'confirmed' ? s.status : '', conflictIds.has(s.id) ? 'conflict' : ''].join(' ');
    const pk = s.studentId ? pkgForDate(s.studentId, t, kwToday()) : null; const st = pk ? stats(pk) : null;
    const flag = s.studentId && !pk ? 'no package' : st && st.state === 'finished' ? 'finished' : st && st.state === 'low' ? `${st.left} left` : '';
    g += `<button class="${cls}" style="grid-column:${i + 2};grid-row:${Math.floor(r0)} / span ${span};background:${esc(tcolor(t))};color:#fff" data-edit-slot="${esc(s.id)}" title="${esc(slotLabel(s) + ' ' + fmtT(s.start) + (s.note ? ' — ' + s.note : ''))}">${span > 1 ? `<span class="bt">${fmtTs(s.start)}–${fmtTs(toMin(s.start) + s.dur)}</span>` : ''}<b>${esc(slotLabel(s))}</b>${span > 2 && flag ? `<span class="bt">${esc(flag)}</span>` : ''}</button>`;
  }
  const gaps = days.filter(d => d !== 5).map(d => {
    const ds = slots.filter(s => s.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!ds.length) return `<div class="card"><b>${DAYS[d]}</b><span class="small muted">No lessons</span></div>`;
    const out = []; let cur = toMin(ds[0].start); for (const s of ds) { const st = toMin(s.start); if (st - cur >= 45) out.push([cur, st]); cur = Math.max(cur, st + s.dur); }
    return `<div class="card"><b>${DAYS[d]}</b><span class="small muted">${fmtT(toMin(ds[0].start))} – ${fmtT(cur)}</span><div class="small">${out.length ? out.map(([a, b]) => `Open ${fmtTs(a)}–${fmtT(b)}`).join('<br>') : 'No gaps of 45 min'}</div></div>`;
  }).join('');
  const weekly = slots.filter(s => s.studentId && s.status !== 'blocked').reduce((a, s) => a + s.dur, 0);
  $('#view').innerHTML = `
  <div class="bar"><h2>Timetable</h2><div class="tchips">${tids.map(id => `<button class="tchip" aria-pressed="${id === t}" data-wt="${esc(id)}"><span class="dot" style="background:${esc(tcolor(id))}"></span>${esc(tname(id))}</button>`).join('')}</div></div>
  <p class="muted small" style="margin:-6px 0 12px">${slots.filter(s => s.studentId).length} weekly lessons · ${Math.round(weekly / 60 * 10) / 10} teaching hours a week.${editable ? ' Click an empty time to add a lesson; click a lesson to change or remove it.' : ''}</p>
  <div class="wk-wrap"><div class="wk" style="grid-template-columns:62px repeat(${days.length},minmax(104px,1fr));grid-template-rows:auto repeat(${rows},var(--row))">${g}</div></div>
  <div class="legend"><span><i class="sw" style="background:${esc(tcolor(t))}"></i>Confirmed</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--warn-soft) 0 4px,var(--surface) 4px 7px);outline:1px dashed var(--warn)"></i>Not confirmed</span><span><i class="sw" style="background:var(--sunk)"></i>Break or unavailable</span><span><i class="sw" style="outline:2px solid var(--bad)"></i>Clash</span></div>
  ${S.teachers[t]?.notes ? `<div class="card" style="padding:12px 14px;margin-top:16px"><div class="eyebrow">Notes and requests</div><div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(S.teachers[t].notes)}</div></div>` : ''}
  <h3 style="margin-top:22px;font-size:16px">Open times</h3><div class="gaps">${gaps}</div>`;
  document.querySelectorAll('[data-wt]').forEach(b => b.onclick = () => { S.weekTeacher = b.dataset.wt; render(); });
}

/* ---------- PACKAGES / ATTENDANCE ---------- */
function meter(s) {
  const tot = Math.max(s.total, s.used, 1); const pct = x => (x / tot * 100).toFixed(1) + '%';
  const col = s.state === 'finished' || s.used > s.total ? 'var(--bad)' : s.state === 'low' ? 'var(--warn)' : 'var(--ok)';
  return `<div class="meter"><div class="track"><i style="width:${pct(s.used)};background:${col}"></i></div><span class="num small">${s.used}/${s.total}</span></div>`;
}
const chips = p => `<div class="chips">${(p.log || []).map(e => `<span class="chip ${esc(e.s)}" title="${esc(ST[e.s]?.label || e.s)}${e.n ? ' — ' + esc(e.n) : ''}">${esc(chipD(e.d))}</span>`).join('')}</div>`;
function renderPackages() {
  const f = S.pkgFilter; const q = f.q.trim().toLowerCase();
  let list = pkgList().map(p => ({ p, s: stats(p) }));
  list = list.filter(({ p, s }) => (f.teacher === 'all' || p.teacherId === f.teacher) && (!q || sname(p.studentId).toLowerCase().includes(q)) && (
    f.state === 'all' || (f.state === 'active' && !p.closed) || (f.state === 'closed' && p.closed) || (f.state === 'attention' && !p.closed && (s.state !== 'active' || s.owed || p.payment !== 'paid' || s.ended)) || (f.state === 'ended' && s.ended) ||
    (f.state === 'owed' && s.owed > 0) || (f.state === 'unpaid' && p.payment !== 'paid' && !p.closed) || (f.state === 'low' && !p.closed && (s.state === 'low' || s.state === 'finished'))));
  list.sort((a, b) => tname(a.p.teacherId).localeCompare(tname(b.p.teacherId)) || sname(a.p.studentId).localeCompare(sname(b.p.studentId)));
  const rows = list.map(({ p, s }) => `<tr data-open-pkg="${esc(p.id)}"><td><b>${esc(sname(p.studentId))}</b><div class="small muted">${esc(KINDS[p.kind] || p.kind)} · ${p.perWeek || 1}× a week${p.subject ? ' · ' + esc(p.subject) : ''}${p.end ? ` · <span style="${s.ended ? 'color:var(--bad)' : ''}">${s.ended ? 'ended' : 'ends'} ${esc(chipD(p.end))}</span>` : ''}</div></td>
   <td><span class="dot" style="background:${esc(tcolor(p.teacherId))}"></span> ${esc(tname(p.teacherId))}</td><td>${meter(s)}</td>
   <td class="num">${s.left < 0 ? `<span style="color:var(--bad)">${s.left}</span>` : s.left}</td>
   <td>${s.owed ? `<span class="pill vio">${s.owed} owed</span>` : '<span class="muted">–</span>'}</td>
   <td>${p.closed ? '<span class="pill">Closed</span>' : s.state === 'finished' ? '<span class="pill bad">Finished</span>' : s.state === 'low' ? '<span class="pill warn">Nearly done</span>' : '<span class="pill ok">Active</span>'}</td>
   <td><span class="pill ${PAY[p.payment]?.[1] || ''}">${esc(PAY[p.payment]?.[0] || '–')}</span></td><td>${chips(p)}</td></tr>`).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Attendance</h2>${isAdmin() ? '<button class="btn primary" id="newPkg">New package</button>' : ''}</div>
  <div class="filters" style="margin-bottom:12px">
   <input type="search" id="pq" placeholder="Search student" value="${esc(f.q)}" aria-label="Search student">
   <select id="pt" aria-label="Teacher"><option value="all">All teachers</option>${teacherIds().map(id => `<option value="${esc(id)}" ${f.teacher === id ? 'selected' : ''}>${esc(tname(id))}</option>`).join('')}</select>
   <select id="ps" aria-label="Show">${[['active', 'Open packages'], ['attention', 'Needs attention'], ['low', 'Nearly done or finished'], ['ended', 'End date passed'], ['owed', 'Makeup owed'], ['unpaid', 'Payment outstanding'], ['closed', 'Closed'], ['all', 'Everything']].map(([k, l]) => `<option value="${k}" ${f.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
   <span class="muted small">${list.length} package${list.length === 1 ? '' : 's'}</span>${isAdmin() ? '<button class="btn sm" id="exportX" style="margin-left:auto">Export to Excel</button>' : ''}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Teacher</th><th>Used</th><th>Left</th><th>Makeups</th><th>Status</th><th>Payment</th><th>Lessons</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty">No packages match.</td></tr>'}</tbody></table></div>
  <div class="legend"><span><i class="chip">6 Sep</i> Present</span><span><i class="chip makeup">6 Sep</i> Makeup lesson</span><span><i class="chip absent">6 Sep</i> Absent, makeup owed</span><span><i class="chip cancelled">6 Sep</i> Teacher cancelled</span><span><i class="chip noshow">6 Sep</i> No-show (charged)</span></div>`;
  $('#pq').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#pq'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#pt').onchange = e => { f.teacher = e.target.value; render(); };
  $('#ps').onchange = e => { f.state = e.target.value; render(); };
  if ($('#newPkg')) $('#newPkg').onclick = () => openModal('newpkg', {});
  if ($('#exportX')) $('#exportX').onclick = exportXlsx;
}

/* ---------- STUDENTS ---------- */
function renderStudents() {
  const f = S.stuFilter; const q = f.q.trim().toLowerCase();
  const ids = studentIds(f.form === 'archived').filter(id => {
    const s = S.students[id];
    if (f.form === 'archived') return s.archived; if (f.form !== 'all' && s.regForm !== f.form) return false;
    if (f.teacher !== 'all' && !pkgList().some(p => p.studentId === id && p.teacherId === f.teacher) && !studentSlots(id).some(x => x.teacherId === f.teacher)) return false;
    return !q || (s.name + ' ' + (s.guardian || '') + ' ' + (s.phone || '')).toLowerCase().includes(q);
  });
  const rows = ids.map(id => {
    const s = S.students[id]; const sl = studentSlots(id); const tset = [...new Set([...pkgList().filter(p => p.studentId === id && !p.closed).map(p => p.teacherId), ...sl.map(x => x.teacherId)])];
    return `<tr data-open-stu="${esc(id)}"><td><b>${esc(s.name)}</b>${s.notes ? `<div class="small muted" style="max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.notes)}</div>` : ''}</td><td>${esc(s.guardian || '–')}</td><td class="mono small">${esc(s.phone || '–')}</td>
    <td><span class="pill ${FORM[s.regForm]?.[1]}">${esc(FORM[s.regForm]?.[0] || '')}</span></td>
    <td>${tset.map(t => `<span class="pill"><span class="dot" style="background:${esc(tcolor(t))}"></span>${esc(tname(t))}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
    <td class="small">${sl.map(x => `${DS[x.day]} ${fmtTs(x.start)}`).join(', ') || '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Students</h2>${isAdmin() ? '<button class="btn primary" id="newStu">Add student</button>' : ''}</div>
  <div class="filters" style="margin-bottom:12px">
   <input type="search" id="sq" placeholder="Search name, parent / guardian, phone" value="${esc(f.q)}" aria-label="Search students">
   <select id="st" aria-label="Teacher"><option value="all">All teachers</option>${teacherIds().map(id => `<option value="${esc(id)}" ${f.teacher === id ? 'selected' : ''}>${esc(tname(id))}</option>`).join('')}</select>
   <select id="sf" aria-label="Form"><option value="all">Any form status</option>${Object.entries(FORM).map(([k, v]) => `<option value="${k}" ${f.form === k ? 'selected' : ''}>${v[0]}</option>`).join('')}<option value="archived" ${f.form === 'archived' ? 'selected' : ''}>Archived students</option></select>
   <span class="muted small">${ids.length} student${ids.length === 1 ? '' : 's'}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Parent / Guardian</th><th>Phone</th><th>Registration form</th><th>Teachers</th><th>Weekly times</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No students match.</td></tr>'}</tbody></table></div>`;
  $('#sq').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#sq'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#st').onchange = e => { f.teacher = e.target.value; render(); };
  $('#sf').onchange = e => { f.form = e.target.value; render(); };
  if ($('#newStu')) $('#newStu').onclick = () => openModal('newstu', {});
}

/* ---------- SETUP (admin) ---------- */
function renderSetup() {
  const st = S.settings;
  const people = S.profiles.map(p => `<tr data-prow="${esc(p.user_id)}"><td>${esc(p.email)}${p.user_id === S.session.user.id ? ' <span class="pill blue">you</span>' : ''}</td>
    <td><select data-pf="role" aria-label="Role" ${p.user_id === S.session.user.id ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><select data-pf="teacher_id" aria-label="Teacher"><option value="">Not a teacher</option>${teacherIds().map(t => `<option value="${esc(t)}" ${p.teacher_id === t ? 'selected' : ''}>${esc(tname(t))}</option>`).join('')}</select></td>
    <td style="white-space:nowrap"><button class="btn sm primary" data-psave="${esc(p.user_id)}">Save</button>${p.user_id === S.session.user.id ? '' : ` <button class="btn sm danger" data-pdel="${esc(p.user_id)}">Remove access</button>`}</td></tr>`).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Setup</h2><button class="btn" id="exportX">Export to Excel</button></div>
  <section style="margin-bottom:22px"><h2 style="font-size:20px;margin-bottom:6px">People</h2>
   <p class="small muted" style="margin:0 0 10px">Anyone can create an account from the sign-in page. They see nothing until you approve them here. Super admins see and change everything. Teachers see and mark only their own students. A super admin who also teaches can be linked to their teacher name too, so their timetable opens first.</p>
   <div class="tbl-wrap people"><table><thead><tr><th>Email</th><th>Access</th><th>Teacher</th><th></th></tr></thead><tbody>${people || '<tr><td colspan="4" class="empty">No accounts yet.</td></tr>'}</tbody></table></div></section>
  <section class="card" style="padding:16px;margin-bottom:18px"><div class="grid2">
    <label class="f">Studio name<input type="text" id="setName" value="${esc(st.schoolName || '')}"></label>
    <label class="f">Current term<input type="text" id="setTerm" value="${esc(st.term || '')}"></label>
    <label class="f">Warn when this many lessons are left<input type="number" min="0" max="10" id="setLow" value="${esc(st.lowThreshold ?? 2)}"></label>
  </div><div class="row-end" style="margin-top:12px"><button class="btn primary" id="saveSet">Save settings</button></div></section>
  <div class="bar"><h2 style="font-size:20px">Teachers</h2><button class="btn" id="addT">Add teacher</button></div>
  <div class="teachers-list">${teacherIds().map(id => {
    const t = S.teachers[id]; const n = slotsOf(id).filter(s => s.studentId).length; const np = pkgList().filter(p => p.teacherId === id && !p.closed).length;
    return `<div class="card" data-tcard="${esc(id)}"><div style="display:flex;gap:10px;align-items:center"><input type="color" value="${esc(t.color || '#447799')}" data-tf="color" aria-label="Colour" style="width:34px;height:30px;border:0;padding:0;background:none"><input type="text" value="${esc(t.name)}" data-tf="name" aria-label="Name" style="flex:1;font-weight:600"></div>
    <label class="f">Instruments or subjects<input type="text" value="${esc(t.subjects || '')}" data-tf="subjects" placeholder="Piano, Vocal"></label>
    <label class="f">Notes and requests<textarea data-tf="notes">${esc(t.notes || '')}</textarea></label>
    <div class="row-end"><span class="small muted" style="margin-right:auto">${n} weekly lessons · ${np} open packages</span><button class="btn sm primary" data-save-t="${esc(id)}">Save</button></div></div>`;
  }).join('')}</div>
  <section style="margin-top:26px"><h2 style="font-size:20px;margin-bottom:10px">How lessons are counted</h2><div class="howto card" style="padding:16px">
   <p><b>Present</b> and <b>Makeup lesson</b> use one lesson from the package.</p>
   <p><b>No-show</b> uses a lesson. Use it when the student missed without notice and gets no makeup.</p>
   <p><b>Absent</b> does not use a lesson. It adds one makeup owed. When the makeup happens, log it as a Makeup lesson and the debt clears.</p>
   <p><b>Teacher cancelled</b> works like Absent: no lesson used, one makeup owed.</p>
   <p><b>Left</b> = package size minus lessons used. A package shows as nearly done at the warning level above and finished at zero.</p>
   <p>Renewing a package closes the old one and starts a new one, so history is kept.</p>
  </div></section>`;
  $('#saveSet').onclick = () => run(sb.from('settings').upsert({ id: 1, school_name: $('#setName').value.trim() || 'Studio Desk', term: $('#setTerm').value.trim(), low_threshold: Math.max(0, +$('#setLow').value || 0) }), 'Settings saved').catch(() => {});
  $('#addT').onclick = () => openModal('newteacher', {});
  $('#exportX').onclick = exportXlsx;
  document.querySelectorAll('[data-save-t]').forEach(b => b.onclick = () => {
    const id = b.dataset.saveT; const c = document.querySelector(`[data-tcard="${CSS.escape(id)}"]`); const patch = {};
    c.querySelectorAll('[data-tf]').forEach(i => patch[i.dataset.tf] = i.value); if (!patch.name.trim()) return toast('A teacher needs a name');
    run(sb.from('teachers').update(patch).eq('id', id), 'Saved').catch(() => {});
  });
  document.querySelectorAll('[data-psave]').forEach(b => b.onclick = () => {
    const uid = b.dataset.psave; const row = document.querySelector(`[data-prow="${CSS.escape(uid)}"]`);
    const role = row.querySelector('[data-pf=role]').value; const teacher_id = row.querySelector('[data-pf=teacher_id]').value || null;
    if (role === 'teacher' && !teacher_id) return toast('Pick which teacher this account belongs to');
    run(sb.from('profiles').update({ role, teacher_id }).eq('user_id', uid), 'Access updated').catch(() => {});
  });
  document.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { const uid = b.dataset.pdel; const p = S.profiles.find(x => x.user_id === uid); confirmBox(`Remove access for ${p?.email}? They can sign up again, but will wait for approval.`, () => run(sb.from('profiles').update({ role: 'pending', teacher_id: null }).eq('user_id', uid), 'Access removed'), 'Remove access'); });
}



/* ---------- PAYMENTS ---------- */
const PKIND = { package: 'Package', book: 'Book', trial: 'Trial lesson', single: 'Single session', other: 'Other' };
const METHODS = ['Company account (link)', 'KNET machine', 'Paid to Ms. Chaimaa', 'Paid to Ms. Nilufar', 'Cash', 'Bank transfer'];
const kd = n => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} KD`;
function paymentsSect(list, sid, pid) {
  const paid = list.filter(x => x.status === 'paid').reduce((a, x) => a + Number(x.amount), 0);
  const pend = list.filter(x => x.status === 'pending').reduce((a, x) => a + Number(x.amount), 0);
  return `<div class="sect" id="paySect"><h3>Payments <span class="muted small" style="font-weight:400">${kd(paid)} paid${pend ? ` · ${kd(pend)} pending` : ''}</span></h3>
   <div class="card" style="padding:4px 12px">${list.length ? list.map(x => `<div class="payrow ${x.status === 'void' ? 'void' : ''}"><div><b>${esc(kd(x.amount))}</b> <span class="pill ${x.status === 'paid' ? 'ok' : x.status === 'void' ? '' : 'warn'}">${x.status === 'paid' ? 'Paid' : x.status === 'void' ? 'Voided' : 'Pending'}</span> <span class="small muted">${esc(PKIND[x.kind] || x.kind)}${x.paid_on ? ' · ' + esc(fmtD(x.paid_on)) : ''}${!pid && x.package_id ? ' · ' + esc(tname(S.packages[x.package_id]?.teacherId)) : ''}</span><div class="small muted">${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''}${x.status === 'void' ? ' · <b>Voided:</b> ' + esc(x.void_reason || '') : ''}</div></div><div style="display:flex;gap:4px">${x.status === 'pending' ? `<button class="btn sm" data-pay-mark="${esc(x.id)}">Mark paid</button>` : ''}${x.status !== 'void' ? `<button class="btn sm danger" data-pay-void="${esc(x.id)}">Void</button>` : ''}</div></div>`).join('') : '<div class="empty small">No payments recorded.</div>'}</div>
   <div class="payadd"><input type="number" min="0" step="0.001" id="payAmt" placeholder="Amount (KD)" aria-label="Amount"><input type="text" id="payMethod" list="payMethods" placeholder="Method" aria-label="Method"><datalist id="payMethods">${METHODS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <select id="payKind" aria-label="For">${Object.entries(PKIND).map(([k, v]) => `<option value="${k}" ${k === (pid ? 'package' : 'book') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="payStatus" aria-label="Status"><option value="paid">Paid</option><option value="pending">Pending</option></select>
    <input type="date" id="payOn" value="${kwToday()}" aria-label="Date"><input type="text" id="payNote" placeholder="Note" aria-label="Note">
    <button class="btn sm primary" id="payAdd" data-sid="${esc(sid)}" data-pid="${esc(pid || '')}">Add payment</button></div></div>`;
}
function wirePayments() {
  const ov = $('#overlay');
  ov.querySelectorAll('[data-pay-void]').forEach(b => b.onclick = () => { const x = S.payments.find(y => y.id === b.dataset.payVoid); reasonBox({ title: 'Void payment', msg: `Void the ${kd(x?.amount)} payment from ${sname(x?.student_id)}? It stays on record, crossed out, and stops counting in totals.`, label: 'Reason (required)', required: true, yes: 'Void payment' }, reason => run(sb.from('payments').update({ status: 'void', void_reason: reason }).eq('id', x.id), 'Payment voided')); });
  ov.querySelectorAll('[data-pay-mark]').forEach(b => b.onclick = () => run(sb.from('payments').update({ status: 'paid', paid_on: kwToday() }).eq('id', b.dataset.payMark), 'Marked as paid').then(() => renderOverlay(true)).catch(() => {}));
  const add = $('#payAdd'); if (!add) return;
  add.onclick = () => {
    const amount = Number($('#payAmt').value); if (!(amount > 0)) return toast('Enter the amount');
    const row = { student_id: add.dataset.sid, package_id: add.dataset.pid || null, amount, method: $('#payMethod').value.trim(), kind: $('#payKind').value, status: $('#payStatus').value, paid_on: $('#payOn').value || null, note: $('#payNote').value.trim() };
    run(sb.from('payments').insert(row), 'Payment recorded').then(() => renderOverlay(true)).catch(() => {});
  };
}
function renderPayments() {
  const f = S.payFilter; const q = f.q.trim().toLowerCase();
  const all = S.payments;
  const list = all.filter(x => (f.status === 'void' || x.status !== 'void') && (f.method === 'all' || (x.method || '—') === f.method) && (f.status === 'all' || x.status === f.status) && (!q || (sname(x.student_id) + ' ' + x.note + ' ' + x.method).toLowerCase().includes(q)));
  const paid = all.filter(x => x.status === 'paid'); const pend = all.filter(x => x.status === 'pending');
  const total = a => a.reduce((s, x) => s + Number(x.amount), 0);
  const byMethod = {}; for (const x of paid) byMethod[x.method || '—'] = (byMethod[x.method || '—'] || 0) + Number(x.amount);
  const byTeacher = {}; for (const x of paid) { const t = x.package_id ? S.packages[x.package_id]?.teacherId : null; const k = t ? tname(t) : 'Not linked to a teacher'; byTeacher[k] = (byTeacher[k] || 0) + Number(x.amount); }
  const unpaidPk = pkgList().filter(p => !p.closed && p.payment !== 'paid');
  const tiles = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="mrow"><span>${esc(k)}</span><b class="num">${esc(kd(v))}</b></div>`).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Payments</h2></div>
  <div class="paygrid">
   <div class="stat"><b>${esc(kd(total(paid)))}</b><span>collected · ${paid.length} payments</span></div>
   <div class="stat"><b style="color:var(--warn)">${esc(kd(total(pend)))}</b><span>pending · ${pend.length}</span></div>
   <div class="stat"><b style="color:var(--bad)">${unpaidPk.length}</b><span>open packages not fully paid</span></div>
  </div>
  <div class="paycols">
   <div class="card" style="padding:12px 14px"><div class="eyebrow">By method</div>${tiles(byMethod) || '<p class="small muted">No payments yet.</p>'}</div>
   <div class="card" style="padding:12px 14px"><div class="eyebrow">By teacher</div>${tiles(byTeacher) || '<p class="small muted">No payments yet.</p>'}</div>
   <div class="card" style="padding:12px 14px"><div class="eyebrow">Not fully paid</div>${unpaidPk.map(p => `<div class="mrow"><a data-open-pkg="${esc(p.id)}" style="cursor:pointer;color:var(--accent)">${esc(sname(p.studentId))}</a><span class="small muted">${esc(tname(p.teacherId))} · ${esc(PAY[p.payment]?.[0] || '')}</span></div>`).join('') || '<p class="small muted">Everyone has paid.</p>'}</div>
  </div>
  <div class="filters" style="margin:16px 0 12px">
   <input type="search" id="yq" placeholder="Search student or note" value="${esc(f.q)}" aria-label="Search payments">
   <select id="ym" aria-label="Method"><option value="all">Any method</option>${[...new Set(all.map(x => x.method || '—'))].sort().map(m => `<option ${f.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
   <select id="ys" aria-label="Status"><option value="all">Paid and pending</option><option value="paid" ${f.status === 'paid' ? 'selected' : ''}>Paid</option><option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Pending</option><option value="void" ${f.status === 'void' ? 'selected' : ''}>Voided</option></select>
   <span class="muted small">${list.length} payments · ${esc(kd(total(list.filter(x => x.status === 'paid'))))}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Amount</th><th>For</th><th>Method</th><th>Status</th><th>Note</th></tr></thead><tbody>${list.map(x => `<tr ${x.package_id ? `data-open-pkg="${esc(x.package_id)}"` : `data-open-stu="${esc(x.student_id)}"`}><td><b>${esc(sname(x.student_id))}</b>${x.package_id ? `<div class="small muted">${esc(tname(S.packages[x.package_id]?.teacherId))}</div>` : ''}</td><td class="num">${esc(kd(x.amount))}</td><td>${esc(PKIND[x.kind] || x.kind)}</td><td class="small">${esc(x.method || '—')}</td><td><span class="pill ${x.status === 'paid' ? 'ok' : x.status === 'void' ? '' : 'warn'}">${x.status === 'paid' ? 'Paid' : x.status === 'void' ? 'Voided' : 'Pending'}</span></td><td class="small muted">${esc(x.note || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No payments match.</td></tr>'}</tbody></table></div>`;
  $('#yq').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#yq'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#ym').onchange = e => { f.method = e.target.value; render(); };
  $('#ys').onchange = e => { f.status = e.target.value; render(); };
}

/* ---------- HISTORY (super admin) ---------- */
const AREAS = { all: 'Everything', lessons: 'Attendance', packages: 'Packages', payments: 'Payments', students: 'Students', slots: 'Timetable', teachers: 'Teachers', profiles: 'People & access', settings: 'Settings', session: 'Sign-ins & exports' };
const FIELD = {
  lesson_date: 'Date', status: 'Status', note: 'Note', package_id: 'Package', sessions: 'Lessons in package', per_week: 'Lessons per week', start_date: 'Start date',
  term: 'Term', payment: 'Payment', paid_note: 'Payment note', price: 'Price (KWD)', notes: 'Notes', closed: 'Closed', kind: 'Type', subject: 'Subject',
  teacher_id: 'Teacher', student_id: 'Student', name: 'Name', guardian: 'Parent / Guardian', phone: 'Phone', reg_form: 'Registration form', archived: 'Archived',
  day: 'Day', start_time: 'Start', dur: 'Length (min)', label: 'Label', subjects: 'Subjects', color: 'Colour', sort_order: 'Order', school_name: 'Studio name',
  low_threshold: 'Warning level', void_reason: 'Void reason', renewed_from: 'Renewed from', role: 'Access', email: 'Email', end_date: 'End date', amount: 'Amount (KWD)', method: 'Method', paid_on: 'Paid on',
};
const HIDDEN_FIELDS = new Set(['id', 'created_at', 'created_by', 'user_id']);
const pkgMemo = {};
function rememberPkgs(rows) { for (const r of rows) if (r.table_name === 'packages') { const d = r.new_data || r.old_data; if (d) pkgMemo[d.id] = { studentId: d.student_id, teacherId: d.teacher_id }; } }
function pkgLabel(pid) { const p = S.packages[pid] || pkgMemo[pid]; return p ? `${sname(p.studentId)} · ${tname(p.teacherId)}` : 'a deleted package'; }
function fmtVal(table, k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'status' && table === 'lessons') return ST[v]?.label || v;
  if (k === 'status' && table === 'slots') return ({ confirmed: 'Confirmed', tentative: 'Not confirmed', blocked: 'Break or unavailable' })[v] || v;
  if (k === 'payment') return PAY[v]?.[0] || v;
  if (k === 'reg_form') return FORM[v]?.[0] || v;
  if (k === 'kind') return KINDS[v] || v;
  if (k === 'role') return ROLES[v] || v;
  if (k === 'teacher_id') return tname(v);
  if (k === 'student_id') return sname(v);
  if (k === 'package_id' || k === 'renewed_from') return pkgLabel(v);
  if (k === 'day') return DAYS[v] || v;
  if (k === 'start_time') return fmtT(v);
  if (k === 'kind' && table === 'payments') return PKIND[v] || v;
  if (k === 'status' && table === 'payments') return ({ paid: 'Paid', pending: 'Pending', void: 'Voided' })[v] || v;
  if (k === 'lesson_date' || k === 'start_date' || k === 'end_date' || k === 'paid_on') return fmtD(v, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
const fmtAt = ts => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuwait', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(ts));
const dayKey = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date(ts));
function actorName(r) {
  const p = S.profiles.find(x => x.user_id === r.actor);
  const t = p?.teacher_id ? tname(p.teacher_id) : '';
  return r.actor_email ? (t ? `${t} (${r.actor_email})` : r.actor_email) : 'Unknown';
}
function describe(r) {
  const d = r.new_data || r.old_data || {}; const A = r.action; const T = r.table_name;
  const verb = A === 'INSERT' ? 'added' : A === 'DELETE' ? 'deleted' : 'changed';
  switch (T) {
    case 'lessons': {
      const who = pkgLabel(d.package_id); const date = fmtD(d.lesson_date);
      if (A === 'INSERT') return `Marked <b>${esc(who)}</b> on ${esc(date)} as <b>${esc(ST[d.status]?.label || d.status)}</b>`;
      if (A === 'DELETE') return `Removed the <b>${esc(ST[d.status]?.label || d.status)}</b> mark for <b>${esc(who)}</b> on ${esc(date)}`;
      return `Changed the lesson for <b>${esc(who)}</b> on ${esc(date)}`;
    }
    case 'packages': {
      const who = `${sname(d.student_id)} · ${tname(d.teacher_id)}`;
      if (A === 'INSERT' && d.renewed_from) return `<b>Renewed</b> the package for <b>${esc(who)}</b>: new ${esc(KINDS[d.kind] || '')} package, ${esc(d.sessions)} lessons from ${esc(fmtD(d.start_date))}`;
      if (A === 'INSERT') return `Created a ${esc(KINDS[d.kind] || '')} package (${esc(d.sessions)} lessons) for <b>${esc(who)}</b>`;
      if (A === 'DELETE') return `Deleted the package for <b>${esc(who)}</b>`;
      if (r.changed.length === 1 && r.changed[0] === 'closed') return `${d.closed ? 'Closed' : 'Reopened'} the package for <b>${esc(who)}</b>`;
      return `Changed the package for <b>${esc(who)}</b>`;
    }
    case 'payments': {
      const who = sname(d.student_id); const amt = `${Number(d.amount).toFixed(3).replace(/\.?0+$/, '')} KD`;
      if (A === 'INSERT') return `Recorded a ${esc(d.status === 'pending' ? 'pending ' : '')}payment of <b>${esc(amt)}</b> from <b>${esc(who)}</b>${d.method ? ` (${esc(d.method)})` : ''}`;
      if (A === 'DELETE') return `Deleted the ${esc(amt)} payment from <b>${esc(who)}</b>`;
      if (r.changed.includes('status') && d.status === 'void') return `<b>Voided</b> the ${esc(amt)} payment from <b>${esc(who)}</b>${d.void_reason ? `: ${esc(d.void_reason)}` : ''}`;
      if (r.changed.includes('status') && d.status === 'paid') return `Marked the ${esc(amt)} payment from <b>${esc(who)}</b> as paid`;
      return `Changed a payment from <b>${esc(who)}</b>`;
    }
    case 'students': return `${A === 'INSERT' ? 'Added' : A === 'DELETE' ? 'Deleted' : r.changed.length === 1 && r.changed[0] === 'archived' ? (d.archived ? 'Archived' : 'Restored') : 'Changed'} student <b>${esc(d.name)}</b>`;
    case 'slots': {
      const what = d.student_id ? sname(d.student_id) : (d.label || 'a slot');
      const when = `${DAYS[d.day] || ''} ${d.start_time ? fmtT(d.start_time) : ''}`;
      if (A === 'INSERT') return `Added <b>${esc(what)}</b> to ${esc(tname(d.teacher_id))}'s timetable, ${esc(when)}`;
      if (A === 'DELETE') return `Removed <b>${esc(what)}</b> from ${esc(tname(d.teacher_id))}'s timetable (${esc(when)})`;
      return `Changed <b>${esc(what)}</b> on ${esc(tname(d.teacher_id))}'s timetable`;
    }
    case 'teachers': return `${verb[0].toUpperCase() + verb.slice(1)} teacher <b>${esc(d.name)}</b>`;
    case 'settings': return 'Changed studio settings';
    case 'profiles':
      if (A === 'INSERT') return `New account signed up: <b>${esc(d.email)}</b> (${esc(ROLES[d.role] || d.role)})`;
      if (A === 'DELETE') return `Deleted the account <b>${esc(d.email)}</b>`;
      return `Changed access for <b>${esc(d.email)}</b>`;
    case 'app_admins': return `${A === 'INSERT' ? 'Added' : 'Removed'} <b>${esc(d.email)}</b> ${A === 'INSERT' ? 'to' : 'from'} the automatic super admin list`;
    case 'session':
      if (A === 'SIGN_IN') return 'Signed in';
      if (A === 'SIGN_OUT') return 'Signed out';
      if (A === 'EXPORT') return `Exported everything to Excel${d.file ? ` (${esc(d.file)})` : ''}`;
      return esc(A);
    default: return `${esc(A)} on ${esc(T)}`;
  }
}
function diffHtml(r) {
  const T = r.table_name;
  if (r.action === 'UPDATE') {
    const keys = r.changed.filter(k => !HIDDEN_FIELDS.has(k));
    return keys.length ? `<ul class="diff">${keys.map(k => `<li><span class="fk">${esc(FIELD[k] || k)}</span> <s>${esc(fmtVal(T, k, r.old_data?.[k]))}</s> → <b>${esc(fmtVal(T, k, r.new_data?.[k]))}</b></li>`).join('')}</ul>` : '';
  }
  const d = r.action === 'DELETE' ? r.old_data : r.new_data;
  if (!d || T === 'session') return d && d.device ? `<div class="small muted">${esc(d.device)}</div>` : '';
  const keys = Object.keys(d).filter(k => !HIDDEN_FIELDS.has(k) && d[k] !== '' && d[k] !== null);
  return `<details class="small"><summary>${r.action === 'DELETE' ? 'What was deleted' : 'All details'}</summary><ul class="diff">${keys.map(k => `<li><span class="fk">${esc(FIELD[k] || k)}</span> ${esc(fmtVal(T, k, d[k]))}</li>`).join('')}</ul></details>`;
}
function histRows(rows, withDays) {
  let last = ''; let h = '';
  for (const r of rows) {
    const dk = dayKey(r.at);
    if (withDays && dk !== last) { h += `<h3 class="hday">${esc(fmtD(dk, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h3>`; last = dk; }
    const tone = r.action === 'DELETE' ? 'bad' : r.action === 'INSERT' ? 'ok' : r.table_name === 'session' ? '' : 'blue';
    h += `<div class="hrow"><div class="htime mono">${esc(withDays ? fmtAt(r.at) : fmtD(dk) + ' ' + fmtAt(r.at))}</div><div class="hbody"><div><span class="pill ${tone}">${esc(AREAS[r.table_name] || r.table_name)}</span> ${describe(r)}</div><div class="small muted">by ${esc(actorName(r))}</div>${diffHtml(r)}</div></div>`;
  }
  return h;
}
async function loadHistory(reset) {
  const H = S.hist; if (H.loading) return; H.loading = true;
  let q = sb.from('audit_log').select('*').order('id', { ascending: false }).limit(200);
  if (H.actor !== 'all') q = H.actor === 'system' ? q.is('actor', null) : q.eq('actor', H.actor);
  if (H.area !== 'all') q = q.eq('table_name', H.area);
  if (H.from) q = q.gte('at', new Date(H.from + 'T00:00:00+03:00').toISOString());
  if (H.to) q = q.lt('at', new Date(addDays(H.to, 1) + 'T00:00:00+03:00').toISOString());
  if (!reset && H.rows.length) q = q.lt('id', H.rows.at(-1).id);
  const { data, error } = await q; H.loading = false;
  if (error) { console.error(error); toast('Could not load the history.'); return; }
  rememberPkgs(data);
  H.rows = reset ? data : H.rows.concat(data); H.done = data.length < 200;
  if (S.tab === 'history') renderHistory();
}
function renderHistory() {
  const H = S.hist;
  if (!H.rows.length && !H.done && !H.loading) { loadHistory(true); }
  const q = H.q.trim().toLowerCase();
  const rows = q ? H.rows.filter(r => (describe(r) + ' ' + diffHtml(r) + ' ' + actorName(r)).replace(/<[^>]+>/g, ' ').toLowerCase().includes(q)) : H.rows;
  $('#view').innerHTML = `
  <div class="bar"><h2>History</h2></div>
  <p class="muted small" style="margin:-6px 0 12px">Every change anyone makes is recorded here automatically by the database: who, when, and exactly what changed. Nobody can edit or delete this history.</p>
  <div class="filters" style="margin-bottom:14px">
   <select id="hA" aria-label="Person"><option value="all">Everyone</option>${S.profiles.map(p => `<option value="${esc(p.user_id)}" ${H.actor === p.user_id ? 'selected' : ''}>${esc(p.email)}</option>`).join('')}<option value="system" ${H.actor === 'system' ? 'selected' : ''}>System (database)</option></select>
   <select id="hT" aria-label="Area">${Object.entries(AREAS).map(([k, v]) => `<option value="${k}" ${H.area === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
   <label class="small muted">From <input type="date" id="hF" value="${esc(H.from)}"></label>
   <label class="small muted">To <input type="date" id="hTo" value="${esc(H.to)}"></label>
   <input type="search" id="hQ" placeholder="Search names, notes, values" value="${esc(H.q)}" aria-label="Search history">
  </div>
  <div class="card hist">${rows.length ? histRows(rows, true) : `<div class="empty">${H.loading || (!H.done && !H.rows.length) ? 'Loading…' : 'No changes match these filters.'}</div>`}</div>
  ${H.done || !H.rows.length ? '' : '<div style="text-align:center;margin-top:14px"><button class="btn" id="hMore">Load older changes</button></div>'}`;
  const refetch = () => { H.rows = []; H.done = false; loadHistory(true); renderHistory(); };
  $('#hA').onchange = e => { H.actor = e.target.value; refetch(); };
  $('#hT').onchange = e => { H.area = e.target.value; refetch(); };
  $('#hF').onchange = e => { H.from = e.target.value; refetch(); };
  $('#hTo').onchange = e => { H.to = e.target.value; refetch(); };
  $('#hQ').oninput = e => { H.q = e.target.value; const pos = e.target.selectionStart; renderHistory(); const el = $('#hQ'); el.focus(); el.setSelectionRange(pos, pos); };
  if ($('#hMore')) $('#hMore').onclick = () => loadHistory(false);
}
const TL_FILTERS = { all: 'Everything', lessons: 'Attendance', packages: 'Packages & renewals', payments: 'Payments', students: 'Details' };
const tl = { key: '', rows: null, filter: 'all', loading: false };
function timelineSect(kind, id) {
  const key = kind + '|' + id;
  if (tl.key !== key) { tl.key = key; tl.rows = null; tl.filter = 'all'; }
  if (!tl.rows && !tl.loading) setTimeout(() => loadTimeline(kind, id), 0);
  const rows = (tl.rows || []).filter(r => tl.filter === 'all' || r.table_name === tl.filter || (tl.filter === 'students' && r.table_name === 'slots'));
  return `<div class="sect" id="tlSect"><h3>Timeline <span class="muted small" style="font-weight:400">every change, newest first</span></h3>
   <div class="tchips">${Object.entries(TL_FILTERS).filter(([k]) => kind === 'student' || k !== 'students').map(([k, v]) => `<button class="tchip" aria-pressed="${tl.filter === k}" data-tl-filter="${k}">${v}</button>`).join('')}</div>
   ${tl.rows === null ? '<div class="small muted">Loading the timeline…</div>' : rows.length ? `<div class="card hist" style="padding:4px 12px">${histRows(rows, false)}</div>` : '<p class="small muted" style="margin:0">Nothing recorded here yet.</p>'}</div>`;
}
async function loadTimeline(kind, id) {
  const key = kind + '|' + id; tl.loading = true;
  const v = `"${id.replace(/"/g, '')}"`;
  const pids = kind === 'package' ? [id] : pkgList().filter(p => p.studentId === id).map(p => p.id);
  const plist = pids.map(x => `"${x.replace(/"/g, '')}"`).join(',');
  const filter = kind === 'package'
    ? `and(table_name.eq.packages,record_id.eq.${v}),new_data->>package_id.eq.${v},old_data->>package_id.eq.${v},new_data->>renewed_from.eq.${v}`
    : `and(table_name.eq.students,record_id.eq.${v}),new_data->>student_id.eq.${v},old_data->>student_id.eq.${v}` + (plist ? `,new_data->>package_id.in.(${plist}),old_data->>package_id.in.(${plist})` : '');
  const { data, error } = await sb.from('audit_log').select('*').or(filter).order('id', { ascending: false }).limit(1000);
  tl.loading = false;
  if (tl.key !== key) return;
  if (error) { console.error(error); tl.rows = []; toast('Could not load the timeline.'); }
  else { rememberPkgs(data); tl.rows = data; }
  const box = $('#tlSect'); if (box) box.outerHTML = timelineSect(kind, id);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tl-filter]'); if (!b) return;
  tl.filter = b.dataset.tlFilter; const [kind, id] = tl.key.split('|'); const box = $('#tlSect'); if (box) box.outerHTML = timelineSect(kind, id);
});
function reasonBox(opts, onYes) { openModal('reason', { ...opts, onYes }); }

/* ---------- overlay: drawers & modals ---------- */
function openDrawer(type, id) { drawer = { type, id }; tl.key = ''; renderOverlay(true); }
function closeOverlay() { drawer = null; modal = null; $('#overlay').innerHTML = ''; }
function renderOverlay(force) {
  if (!drawer) { $('#overlay').innerHTML = ''; return; }
  if (drawer.type === 'modal' && !force) return;
  const a = document.activeElement;
  if (!force && a && $('#overlay').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  const sc = $('#overlay .drawer')?.scrollTop;
  if (drawer.type === 'package') drawPackage(drawer.id);
  else if (drawer.type === 'student') drawStudent(drawer.id);
  else if (drawer.type === 'modal') drawModal();
  const dr = $('#overlay .drawer'); if (dr && sc) dr.scrollTop = sc;
}
function shell(title, sub, body, isModal) {
  $('#overlay').innerHTML = isModal ? `<div class="scrim center" data-scrim><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}</div></div>`
    : `<div class="scrim" data-scrim><div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dh"><div style="flex:1;min-width:0"><h2>${esc(title)}</h2>${sub ? `<div class="small muted">${sub}</div>` : ''}</div><button class="btn ghost" data-close aria-label="Close">✕</button></div><div class="db">${body}</div></div></div>`;
}
$('#overlay').addEventListener('mousedown', e => { if (e.target.hasAttribute('data-scrim')) closeOverlay(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer) closeOverlay(); });

function drawPackage(id) {
  const p = S.packages[id]; if (!p) { closeOverlay(); return; }
  const s = stats(p); const A = isAdmin(); const dis = A ? '' : 'disabled';
  const opts = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(Array.isArray(v) ? v[0] : (v.label || v))}</option>`).join('');
  const log = (p.log || []).map(e => `<div class="logrow"><input type="date" value="${esc(e.d)}" data-lg="${esc(e.id)}|lesson_date" aria-label="Date"><select data-lg="${esc(e.id)}|status" aria-label="Status">${opts(ST, e.s)}</select><input class="lnote" type="text" value="${esc(e.n || '')}" placeholder="Note" data-lg="${esc(e.id)}|note" aria-label="Note"><button class="btn ghost sm" data-lgdel="${esc(e.id)}" aria-label="Remove">✕</button></div>`).join('');
  shell(sname(p.studentId), `${esc(tname(p.teacherId))} · ${esc(KINDS[p.kind] || '')} package${p.term ? ' · ' + esc(p.term) : ''}`, `
   ${p.closed ? '<div class="infobox">This package is closed. It is kept for history.</div>' : s.used > s.total ? `<div class="badbox">${s.used - s.total} lesson(s) used beyond the package. Renew and move the extra lessons, or adjust the size.</div>` : s.state === 'finished' ? '<div class="badbox">All lessons used. Renew to keep marking attendance.</div>' : ''}
   ${s.ended ? `<div class="warnbox">This package's end date (${esc(fmtD(p.end))}) has passed${s.left > 0 ? ` with ${s.left} lessons not used` : ''}. Renew or close it.</div>` : ''}
   <div class="stats"><div class="stat"><b>${s.used}</b><span>used of ${s.total}</span></div><div class="stat"><b style="color:${s.left <= 0 ? 'var(--bad)' : s.state === 'low' ? 'var(--warn)' : 'inherit'}">${s.left}</b><span>left</span></div><div class="stat"><b>${s.owed}</b><span>makeups owed</span></div><div class="stat"><b>${s.c.absent + s.c.cancelled}</b><span>missed</span></div></div>
   <div class="sect"><h3>Lessons <span class="muted small" style="font-weight:400">${(p.log || []).length} logged${s.last ? ' · last ' + esc(fmtD(s.last)) : ''}</span></h3>
    <div class="card" style="padding:4px 12px"><div class="loglist">${log || '<div class="empty small">No lessons logged yet.</div>'}</div></div>
    <div class="logrow" style="border:0"><input type="date" id="nlD" value="${kwToday()}" aria-label="New lesson date"><select id="nlS" aria-label="New lesson status">${opts(ST, 'present')}</select><input class="lnote" type="text" id="nlN" placeholder="Note (optional)" aria-label="New lesson note"><button class="btn sm primary" id="nlAdd" aria-label="Add lesson">+</button></div>
   </div>
   <div class="sect"><h3>Package</h3><div class="grid2">
    <label class="f">Teacher<select id="pT" ${dis}>${teacherIds().map(t => `<option value="${esc(t)}" ${p.teacherId === t ? 'selected' : ''}>${esc(tname(t))}</option>`).join('')}</select></label>
    <label class="f">Type<select id="pK" ${dis}>${opts(KINDS, p.kind)}</select></label>
    <label class="f">Lessons in package<input type="number" min="1" id="pN" value="${esc(p.sessions)}" ${dis}></label>
    <label class="f">Lessons per week<input type="number" min="1" max="7" id="pW" value="${esc(p.perWeek || 1)}" ${dis}></label>
    <label class="f">Start date<input type="date" id="pS" value="${esc(p.start || '')}" ${dis}></label>
    <label class="f">End date<input type="date" id="pE" value="${esc(p.end || '')}" ${dis}></label>
    <label class="f">Term or month<input type="text" id="pTerm" value="${esc(p.term || '')}" ${dis}></label>
    <label class="f">Subject<input type="text" id="pSub" value="${esc(p.subject || '')}" placeholder="Piano, Vocal…" ${dis}></label>
    <label class="f">Payment<select id="pP" ${dis}>${opts(PAY, p.payment || 'unpaid')}</select></label>
    <label class="f">Price (KWD)<input type="number" min="0" step="0.001" id="pPr" value="${esc(p.price ?? '')}" ${dis}></label>
    <label class="f">Payment note<input type="text" id="pPn" value="${esc(p.paidNote || '')}" ${dis}></label>
   </div><label class="f">Notes<textarea id="pNo" ${dis}>${esc(p.notes || '')}</textarea></label>
   ${A ? `<div class="row-end">${p.closed ? '<button class="btn sm" id="pReopen">Reopen</button>' : '<button class="btn sm" id="pClose">Close</button><button class="btn sm" id="pRenew">Renew</button>'}<button class="btn primary sm" id="pSave">Save package</button></div>` : '<p class="small muted" style="margin:0">Only a super admin can change package details.</p>'}</div>
   <div class="sect"><h3>Weekly times with ${esc(tname(p.teacherId))}</h3><div class="small">${slotsOf(p.teacherId).filter(x => x.studentId === p.studentId).map(x => `${DAYS[x.day]} ${fmtT(x.start)} (${x.dur} min)${x.status === 'tentative' ? ' · not confirmed' : ''}`).join('<br>') || '<span class="muted">Not on the timetable.</span>'}</div>
   <div><button class="btn sm" data-open-stu="${esc(p.studentId)}">Open student</button></div></div>
   ${A ? paymentsSect(S.payments.filter(x => x.package_id === id), p.studentId, id) : ''}
   ${A ? timelineSect('package', id) : ''}`);
  wirePayments();
  const ov = $('#overlay');
  ov.querySelectorAll('[data-lg]').forEach(el => el.onchange = () => { const [lid, col] = el.dataset.lg.split('|'); if (col === 'lesson_date' && !el.value) return; run(sb.from('lessons').update({ [col]: el.value }).eq('id', lid)).then(() => renderOverlay(true)).catch(() => {}); });
  ov.querySelectorAll('[data-lgdel]').forEach(b => b.onclick = () => { const e = (p.log || []).find(x => x.id === b.dataset.lgdel); confirmBox(`Remove the "${ST[e?.s]?.label || ''}" mark on ${fmtD(e?.d)}? This is recorded in History.`, () => run(sb.from('lessons').delete().eq('id', b.dataset.lgdel), 'Mark removed'), 'Remove mark'); });
  $('#nlAdd').onclick = () => { const d = $('#nlD').value; if (!d) return toast('Pick a date'); if (entryFor(p, d)) return toast('A lesson is already logged on that date'); run(sb.from('lessons').insert({ package_id: id, lesson_date: d, status: $('#nlS').value, note: $('#nlN').value.trim() }), 'Lesson added').then(() => renderOverlay(true)).catch(() => {}); };
  if (!A) return;
  $('#pSave').onclick = () => savePkg(id, { teacherId: $('#pT').value, kind: $('#pK').value, sessions: Math.max(1, +$('#pN').value || 1), perWeek: Math.max(1, Math.min(7, +$('#pW').value || 1)), start: $('#pS').value, end: $('#pE').value, term: $('#pTerm').value.trim(), subject: $('#pSub').value.trim(), payment: $('#pP').value, price: $('#pPr').value === '' ? null : +$('#pPr').value, paidNote: $('#pPn').value.trim(), notes: $('#pNo').value }, 'Package saved').then(() => renderOverlay(true)).catch(() => {});
  const stamp = what => `${what} ${fmtD(kwToday(), { day: 'numeric', month: 'short', year: 'numeric' })} by ${S.session.user.email}`;
  if ($('#pClose')) $('#pClose').onclick = () => reasonBox({ title: 'Close package', msg: 'Closing keeps the package and its lessons for history. It stops showing as open.', label: 'Reason (optional)', yes: 'Close package' }, reason => savePkg(id, { closed: true, notes: [p.notes, stamp('Closed') + (reason ? ': ' + reason : '')].filter(Boolean).join('\n') }, 'Package closed'));
  if ($('#pReopen')) $('#pReopen').onclick = () => reasonBox({ title: 'Reopen package', msg: 'Reopen this package so lessons can be marked on it again?', label: 'Reason (optional)', yes: 'Reopen' }, reason => savePkg(id, { closed: false, notes: [p.notes, stamp('Reopened') + (reason ? ': ' + reason : '')].filter(Boolean).join('\n') }, 'Package reopened'));
  if ($('#pRenew')) $('#pRenew').onclick = () => openModal('newpkg', { studentId: p.studentId, teacherId: p.teacherId, renewOf: id });
}
function drawStudent(id) {
  const s = S.students[id]; if (!s) { closeOverlay(); return; }
  const A = isAdmin(); const dis = A ? '' : 'disabled';
  const pk = pkgList().filter(p => p.studentId === id).sort((a, b) => (a.closed - b.closed) || (b.start || '').localeCompare(a.start || ''));
  const sl = studentSlots(id);
  shell(s.name, s.archived ? 'Archived' : '', `
   <div class="grid2">
    <label class="f">Name<input type="text" id="sN" value="${esc(s.name)}" ${dis}></label>
    <label class="f">Parent / Guardian<input type="text" id="sG" value="${esc(s.guardian || '')}" ${dis}></label>
    <label class="f">Phone<input type="tel" id="sP" value="${esc(s.phone || '')}" ${dis}></label>
    <label class="f">Registration form<select id="sF" ${dis}>${Object.entries(FORM).map(([k, v]) => `<option value="${k}" ${s.regForm === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
   </div><label class="f">Notes<textarea id="sNo" ${dis}>${esc(s.notes || '')}</textarea></label>
   ${A ? `<div class="row-end"><button class="btn sm" id="sArch">${s.archived ? 'Restore' : 'Archive'}</button><button class="btn sm primary" id="sSave">Save student</button></div>` : ''}
   <div class="sect"><h3>Packages</h3>${pk.map(p => { const st = stats(p); return `<div class="card" style="padding:10px 12px;cursor:pointer" data-open-pkg="${esc(p.id)}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="dot" style="background:${esc(tcolor(p.teacherId))}"></span><b>${esc(tname(p.teacherId))}</b><span class="muted small">${esc(KINDS[p.kind] || '')} · ${esc(p.term || '')}</span><span style="margin-left:auto" class="pill ${p.closed ? '' : st.state === 'finished' ? 'bad' : st.state === 'low' ? 'warn' : 'ok'}">${p.closed ? 'Closed' : st.left + ' left'}</span></div>${meter(st)}${chips(p)}</div>`; }).join('') || '<p class="muted small">No packages yet.</p>'}
    ${A ? '<div><button class="btn sm" id="sNewPkg">New package</button></div>' : ''}</div>
   <div class="sect"><h3>Weekly timetable</h3><div class="small">${sl.map(x => `<span class="dot" style="background:${esc(tcolor(x.teacherId))}"></span> ${DAYS[x.day]} ${fmtT(x.start)} · ${esc(tname(x.teacherId))}${x.status === 'tentative' ? ' · not confirmed' : ''}`).join('<br>') || '<span class="muted">Not on the timetable.</span>'}</div></div>
   ${A ? paymentsSect(S.payments.filter(x => x.student_id === id), id, null) : ''}
   ${A ? timelineSect('student', id) : ''}`);
  if (!A) return;
  wirePayments();
  $('#sSave').onclick = () => { const patch = { name: $('#sN').value.trim(), guardian: $('#sG').value.trim(), phone: $('#sP').value.trim(), regForm: $('#sF').value, notes: $('#sNo').value }; if (!patch.name) return toast('A student needs a name'); run(sb.from('students').update(toRow(patch, stuCols)).eq('id', id), 'Student saved').then(() => renderOverlay(true)).catch(() => {}); };
  $('#sArch').onclick = () => s.archived ? run(sb.from('students').update({ archived: false }).eq('id', id), 'Restored').catch(() => {}) : confirmBox(`Archive ${s.name}? They disappear from lists but all their packages, lessons and payments stay on record. You can restore them any time from Students → Archived.`, () => run(sb.from('students').update({ archived: true }).eq('id', id), 'Archived'), 'Archive');
  $('#sNewPkg').onclick = () => openModal('newpkg', { studentId: id });
}

function openModal(kind, ctx) { modal = { kind, ctx, prev: drawer }; drawer = { type: 'modal' }; renderOverlay(true); }
function backFromModal() { const prev = modal?.prev; modal = null; drawer = prev || null; renderOverlay(true); }
function confirmBox(msg, onYes, yesLabel) { openModal('confirm', { msg, onYes, yesLabel }); }
const stuOptions = sel => '<option value="">Choose a student</option>' + studentIds().map(id => `<option value="${esc(id)}" ${sel === id ? 'selected' : ''}>${esc(sname(id))}</option>`).join('');
const teaOptions = (sel, only) => teacherIds().filter(id => !only || id === only).map(id => `<option value="${esc(id)}" ${sel === id ? 'selected' : ''}>${esc(tname(id))}</option>`).join('');
function drawModal() {
  const { kind, ctx } = modal; const cancel = '<button class="btn" data-mcancel>Cancel</button>';
  if (kind === 'confirm') {
    shell('Please confirm', '', `<p style="margin:0">${esc(ctx.msg)}</p><div class="row-end">${ctx.onYes ? cancel + `<button class="btn primary" id="mYes">${esc(ctx.yesLabel || 'Confirm')}</button>` : '<button class="btn primary" data-mcancel>OK</button>'}</div>`, true);
    if (ctx.onYes) $('#mYes').onclick = async () => { const f = ctx.onYes; backFromModal(); try { await f(); } catch (e) { /* toast shown */ } };
  } else if (kind === 'reason') {
    shell(ctx.title, '', `<p style="margin:0">${esc(ctx.msg)}</p><label class="f">${esc(ctx.label)}<textarea id="mReason" style="min-height:70px"></textarea></label><div class="row-end">${cancel}<button class="btn primary" id="mYes">${esc(ctx.yes || 'Confirm')}</button></div>`, true);
    $('#mYes').onclick = async () => { const reason = $('#mReason').value.trim(); if (ctx.required && !reason) return toast('Please give a reason'); const f = ctx.onYes; backFromModal(); try { await f(reason); renderOverlay(true); } catch (e) { /* toast shown */ } };
  } else if (kind === 'newstu') {
    shell('Add student', '', `<div class="grid2"><label class="f">Name<input type="text" id="mN"></label><label class="f">Parent / Guardian<input type="text" id="mG"></label><label class="f">Phone<input type="tel" id="mP"></label><label class="f">Registration form<select id="mF">${Object.entries(FORM).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Add student</button></div>`, true);
    $('#mOk').onclick = async () => {
      const name = $('#mN').value.trim(); if (!name) return toast('Enter a name');
      if (studentIds(true).some(id => sname(id).toLowerCase() === name.toLowerCase())) return toast('A student with that name already exists');
      const id = slug(name) + '-' + rid();
      try { await run(sb.from('students').insert({ id, name, guardian: $('#mG').value.trim(), phone: $('#mP').value.trim(), reg_form: $('#mF').value }), 'Student added'); modal = null; openDrawer('student', id); } catch (e) { /* toast shown */ }
    };
  } else if (kind === 'newteacher') {
    shell('Add teacher', '', `<label class="f">Name<input type="text" id="mN" placeholder="Ms. …"></label><label class="f">Instruments or subjects<input type="text" id="mS"></label><div class="row-end">${cancel}<button class="btn primary" id="mOk">Add teacher</button></div>`, true);
    $('#mOk').onclick = async () => {
      const name = $('#mN').value.trim(); if (!name) return toast('Enter a name'); const id = slug(name) + '-' + rid();
      const palette = ['#6b3d78', '#a8722a', '#8c3b4a', '#3f6b5a', '#2f5373', '#7a5c2e', '#5a2f5e', '#4a6b7a'];
      backFromModal();
      await run(sb.from('teachers').insert({ id, name, subjects: $('#mS')?.value?.trim() || '', color: palette[Object.keys(S.teachers).length % palette.length], sort_order: Object.keys(S.teachers).length + 1 }), 'Teacher added').catch(() => {});
    };
  } else if (kind === 'newpkg') {
    const old = ctx.renewOf ? S.packages[ctx.renewOf] : null; const os = old ? stats(old) : null;
    shell(old ? 'Renew package' : 'New package', '', `
     ${old ? `<div class="infobox">The current package (${os.used} of ${os.total} used${os.owed ? `, ${os.owed} makeup owed` : ''}) will be closed and kept in history.${os.used > os.total ? ` The ${os.used - os.total} extra lesson(s) will move to the new package.` : ''}</div>` : ''}
     <div class="grid2"><label class="f">Student<select id="mSt" ${old ? 'disabled' : ''}>${stuOptions(ctx.studentId)}</select></label>
     <label class="f">Teacher<select id="mT">${teaOptions(ctx.teacherId || S.weekTeacher || teacherIds()[0])}</select></label>
     <label class="f">Type<select id="mK">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(old?.kind || 'semester') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
     <label class="f">Lessons in package<input type="number" id="mNn" min="1" value="${esc(old?.sessions || 30)}"></label>
     <label class="f">Lessons per week<input type="number" id="mW" min="1" max="7" value="${esc(old?.perWeek || 2)}"></label>
     <label class="f">Start date<input type="date" id="mS" value="${kwToday()}"></label>
     <label class="f">End date<input type="date" id="mE" value=""></label>
     <label class="f">Term or month<input type="text" id="mTerm" value="${esc(old?.term && old.kind === 'semester' ? old.term : (S.settings.term || ''))}"></label>
     <label class="f">Payment<select id="mP">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === 'unpaid' ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
     <label class="f">Price (KWD)<input type="number" id="mPr" min="0" step="0.001"></label></div>
     <p class="small muted" style="margin:0">Common sizes: semester 30 (twice a week) or 15 (once a week); monthly 8 or 4.</p>
     <div class="row-end">${cancel}<button class="btn primary" id="mOk">${old ? 'Renew' : 'Create package'}</button></div>`, true);
    const sync = () => { const k = $('#mK').value; const w = +$('#mW').value; if (k === 'semester') $('#mNn').value = w >= 2 ? 30 : 15; else if (k === 'monthly') $('#mNn').value = w >= 2 ? 8 : 4; };
    $('#mK').onchange = sync; $('#mW').onchange = sync;
    $('#mOk').onclick = async () => {
      const sid = old ? old.studentId : $('#mSt').value; if (!sid) return toast('Choose a student'); const tid = $('#mT').value; if (!tid) return toast('Add a teacher first');
      const id = `${tid}--${sid}--${Date.now().toString(36)}`;
      const row = { id, renewed_from: old ? ctx.renewOf : null, student_id: sid, teacher_id: tid, subject: old?.subject || '', kind: $('#mK').value, sessions: Math.max(1, +$('#mNn').value || 1), per_week: Math.max(1, Math.min(7, +$('#mW').value || 1)), start_date: $('#mS').value || kwToday(), end_date: $('#mE').value || null, term: $('#mTerm').value.trim(), payment: $('#mP').value, price: $('#mPr').value === '' ? null : +$('#mPr').value, notes: old && os.owed ? `${os.owed} makeup(s) still owed from the previous package.` : '' };
      try {
        await run(sb.from('packages').insert(row));
        if (old) {
          if (os.used > os.total) { const counted = (old.log || []).filter(e => ST[e.s]?.counts); const extra = counted.slice(os.total).map(e => e.id); await run(sb.from('lessons').update({ package_id: id }).in('id', extra)); }
          await run(sb.from('packages').update({ closed: true }).eq('id', ctx.renewOf));
        }
        toast(old ? 'Package renewed' : 'Package created'); modal = null; openDrawer('package', id);
      } catch (e) { /* toast shown */ }
    };
  } else if (kind === 'extra') {
    const only = isAdmin() ? null : myTeacher();
    shell('Log makeup or extra lesson', '', `<div class="grid2"><label class="f">Teacher<select id="mT">${teaOptions(only || S.weekTeacher || teacherIds()[0], only)}</select></label><label class="f">Student<select id="mSt">${stuOptions('')}</select></label>
     <label class="f">Date<input type="date" id="mD" value="${esc(ctx.date || kwToday())}"></label><label class="f">What happened<select id="mSs">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === 'makeup' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label></div>
     <label class="f">Note<input type="text" id="mNo" placeholder="e.g. makeup for 14 Sep"></label><div id="mInfo" class="small muted"></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Log lesson</button></div>`, true);
    const info = () => { const sid = $('#mSt').value, tid = $('#mT').value; const p = sid ? pkgForDate(sid, tid, $('#mD').value) : null; $('#mInfo').innerHTML = !sid ? '' : p ? `Goes on the ${esc(KINDS[p.kind] || '')} package: ${stats(p).used} of ${stats(p).total} used, ${stats(p).owed} makeup owed.` : '<span style="color:var(--bad)">This student has no package with this teacher.</span>'; };
    ['mT', 'mSt', 'mD'].forEach(i => $('#' + i).onchange = info);
    $('#mOk').onclick = async () => {
      const sid = $('#mSt').value, tid = $('#mT').value, d = $('#mD').value; if (!sid || !d) return toast('Choose a student and date');
      const p = pkgForDate(sid, tid, d); if (!p) return toast('This student has no package with this teacher');
      if (entryFor(p, d)) return toast('A lesson is already logged for that date. Edit it in the package.');
      const st = $('#mSs').value, no = $('#mNo').value.trim(); closeOverlay();
      await setLog(p.id, d, st, no).then(() => toast('Lesson logged')).catch(() => {});
    };
  } else if (kind === 'slot') {
    const tid = ctx.teacherId; const ex = ctx.slotId ? slotsOf(tid).find(s => s.id === ctx.slotId) : null; const editable = canEditSlots(tid);
    const sl = ex ? { ...ex } : { id: '', day: ctx.day, start: ctx.start, dur: 45, studentId: null, label: '', status: 'confirmed', note: '' };
    const dis = editable ? '' : 'disabled';
    shell(ex ? (editable ? 'Edit lesson time' : 'Lesson time') : 'Add lesson time', '', `
     <div class="grid2"><label class="f">Teacher<input type="text" value="${esc(tname(tid))}" disabled></label>
      <label class="f">Day<select id="mDay" ${dis}>${DAYS.map((d, i) => `<option value="${i}" ${sl.day === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="f">Start<input type="time" id="mStart" step="300" value="${esc(sl.start)}" ${dis}></label>
      <label class="f">Length (minutes)<select id="mDur" ${dis}>${[15, 30, 45, 60, 75, 90].map(m => `<option ${sl.dur === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">Student<select id="mSt" ${dis}><option value="">No student (break, group, reserved)</option>${studentIds().map(id => `<option value="${esc(id)}" ${sl.studentId === id ? 'selected' : ''}>${esc(sname(id))}</option>`).join('')}</select></label>
      <label class="f">Label if no student<input type="text" id="mLab" value="${esc(sl.label || '')}" placeholder="Break, Group class…" ${dis}></label>
      <label class="f">Status<select id="mStat" ${dis}>${[['confirmed', 'Confirmed'], ['tentative', 'Not confirmed yet'], ['blocked', 'Break or unavailable']].map(([k, l]) => `<option value="${k}" ${sl.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
     <label class="f">Note<input type="text" id="mNote" value="${esc(sl.note || '')}" ${dis}></label>
     <div id="mConf"></div>
     <div class="row-end">${ex && editable ? '<button class="btn danger" id="mDel" style="margin-right:auto">Remove</button>' : ''}${editable ? cancel + '<button class="btn primary" id="mOk">Save</button>' : '<button class="btn primary" data-mcancel>Close</button>'}</div>`, true);
    const read = () => ({ ...sl, day: +$('#mDay').value, start: $('#mStart').value || sl.start, dur: +$('#mDur').value, studentId: $('#mSt').value || null, label: $('#mLab').value.trim(), status: $('#mStat').value, note: $('#mNote').value.trim() });
    const check = () => {
      const n = read(); const c = conflictsFor(tid, n); let h = '';
      if (c.teacher.length) h += `<div class="badbox">Clashes with ${c.teacher.map(x => esc(slotLabel(x)) + ' at ' + fmtT(x.start)).join(', ')} for ${esc(tname(tid))}.</div>`;
      if (c.student.length) h += `<div class="warnbox" style="margin-top:6px">${esc(sname(n.studentId))} already has ${c.student.map(x => esc(tname(x.teacherId)) + ' at ' + fmtT(x.start)).join(', ')} on ${DAYS[n.day]}.</div>`;
      if (n.studentId && !pairPkgs(n.studentId, tid).some(p => !p.closed)) h += `<div class="infobox" style="margin-top:6px">${esc(sname(n.studentId))} has no open package with ${esc(tname(tid))}.</div>`;
      $('#mConf').innerHTML = h; return c;
    };
    ['mDay', 'mStart', 'mDur', 'mSt'].forEach(i => $('#' + i).addEventListener('change', check)); check();
    if (editable) {
      $('#mOk').onclick = async () => {
        const n = read(); const c = check(); if (c.teacher.length) return toast('Move it so it does not overlap another lesson');
        if (!n.studentId && !n.label) n.label = n.status === 'blocked' ? 'Break' : 'Reserved';
        if (!n.id) n.id = `${tid}-${n.day}-${n.start}-${rid()}`;
        backFromModal(); await run(sb.from('slots').upsert(slotRow(tid, n)), 'Timetable saved').catch(() => {});
      };
      if (ex) $('#mDel').onclick = async () => { backFromModal(); await run(sb.from('slots').delete().eq('id', ex.id), 'Removed from timetable').catch(() => {}); };
    }
  }
  $('#overlay').querySelectorAll('[data-mcancel]').forEach(b => b.onclick = backFromModal);
  const af = $('#overlay input:not([disabled]),#overlay select:not([disabled])'); if (af && kind !== 'confirm') setTimeout(() => af.focus(), 0);
}

/* ---------- global click delegation ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-open-pkg],[data-open-stu],[data-mark],[data-new-pkg],[data-goto-date],[data-add-slot],[data-edit-slot],[data-close]'); if (!t) return;
  if (t.hasAttribute('data-close')) return closeOverlay();
  if (t.dataset.openPkg) { e.preventDefault(); return openDrawer('package', t.dataset.openPkg); }
  if (t.dataset.openStu) { e.preventDefault(); return openDrawer('student', t.dataset.openStu); }
  if (t.dataset.newPkg) { const [sid, tid] = t.dataset.newPkg.split('|'); return openModal('newpkg', { studentId: sid, teacherId: tid }); }
  if (t.dataset.gotoDate) { S.date = t.dataset.gotoDate; S.tab = 'today'; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.addSlot) { const [d, st] = t.dataset.addSlot.split('|'); return openModal('slot', { teacherId: S.weekTeacher, day: +d, start: st }); }
  if (t.dataset.editSlot) return openModal('slot', { teacherId: S.weekTeacher, slotId: t.dataset.editSlot });
  if (t.dataset.mark) {
    const [pid, d, k] = t.dataset.mark.split('|'); const cur = entryFor(S.packages[pid], d);
    t.closest('.seg')?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await setLog(pid, d, cur?.s === k ? null : k); } catch (err) { render(); }
  }
});

/* ---------- export ---------- */
async function exportXlsx() {
  const X = await import('xlsx');
  const wb = X.utils.book_new();
  const att = [['Teacher', 'Student', 'Subject', 'Type', 'Term', 'Start', 'End', 'Lessons', 'Used', 'Left', 'Makeups owed', 'Payment', 'Status', 'Lessons logged']];
  for (const p of pkgList().sort((a, b) => tname(a.teacherId).localeCompare(tname(b.teacherId)) || sname(a.studentId).localeCompare(sname(b.studentId)))) {
    const s = stats(p);
    att.push([tname(p.teacherId), sname(p.studentId), p.subject || '', KINDS[p.kind] || p.kind, p.term || '', p.start || '', p.end || '', s.total, s.used, s.left, s.owed, PAY[p.payment]?.[0] || '', p.closed ? 'Closed' : s.state, ...(p.log || []).map(e => `${e.d}${e.s === 'present' ? '' : ' (' + (ST[e.s]?.seg || e.s) + ')'}`)]);
  }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(att), 'Attendance');
  for (const t of teacherIds()) {
    const sl = slotsOf(t); if (!sl.length) continue; const times = [...new Set(sl.map(s => s.start))].sort(); const days = [0, 1, 2, 3, 4, 5, 6].filter(d => sl.some(s => s.day === d));
    const rows = [['Time', ...days.map(d => DAYS[d])], ...times.map(tm => [fmtT(tm), ...days.map(d => { const s = sl.find(x => x.day === d && x.start === tm); return s ? slotLabel(s) + (s.status === 'tentative' ? ' (not confirmed)' : '') : ''; })])];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), tname(t).replace(/[\\/?*[\]:]/g, '').slice(0, 31));
  }
  const st = [['Student', 'Parent / Guardian', 'Phone', 'Registration form', 'Notes', 'Archived']];
  for (const id of studentIds(true)) { const s = S.students[id]; st.push([s.name, s.guardian || '', s.phone || '', FORM[s.regForm]?.[0] || '', s.notes || '', s.archived ? 'Yes' : '']); }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(st), 'Students');
  const pays = [['Student', 'Teacher', 'Amount (KD)', 'For', 'Method', 'Status', 'Paid on', 'Note']];
  for (const x of S.payments) pays.push([sname(x.student_id), x.package_id ? tname(S.packages[x.package_id]?.teacherId) : '', Number(x.amount), PKIND[x.kind] || x.kind, x.method || '', x.status, x.paid_on || '', x.note || '']);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(pays), 'Payments');
  X.writeFile(wb, `studio-${kwToday()}.xlsx`);
  sb.rpc('log_event', { p_action: 'EXPORT', p_detail: { file: `studio-${kwToday()}.xlsx`, packages: pkgList().length } }).then(() => {}, () => {});
}

/* ---------- start ---------- */
try { const t = localStorage.getItem('sd-tab'); if (t && ['today', 'week', 'packages', 'students', 'payments', 'history', 'setup'].includes(t)) S.tab = t; } catch (e) { /* ignore */ }
render();
