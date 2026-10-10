import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- state ---------- */
const S = {
  teachers: {}, students: {}, packages: {}, profiles: [], payments: [], expenses: [],
  settings: { schoolName: 'Studio Desk', term: '', lowThreshold: 2 },
  session: null, me: null, loaded: false, authMode: 'signin', recovery: false,
  tab: 'today', date: null, weekTeacher: null, weekStart: null,
  pkgFilter: { teacher: 'all', state: 'active', q: '' }, payFilter: { q: '', method: 'all', status: 'all' }, payView: 'in', exFilter: { month: '', cat: 'all', q: '', showVoid: false }, hist: { rows: [], actor: 'all', area: 'all', q: '', from: '', to: '', done: false, loading: false }, stuFilter: { q: '', form: 'all', teacher: 'all' },
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
const tcolor = id => { const c = S.teachers[id]?.color; return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#777788'; };
const teacherIds = () => Object.keys(S.teachers).sort((a, b) => (S.teachers[a].order ?? 99) - (S.teachers[b].order ?? 99) || tname(a).localeCompare(tname(b)));
const studentIds = incArch => Object.keys(S.students).filter(id => incArch || !S.students[id].archived).sort((a, b) => sname(a).localeCompare(sname(b)));
const slotsOf = tid => S.teachers[tid]?.slots || [];
/* ---------- photos (private bucket, signed URLs) ---------- */
const photoUrls = {};
async function refreshPhotoUrls() {
  const now = Date.now();
  const paths = [...Object.values(S.teachers), ...Object.values(S.students)].map(x => x.photo).filter(Boolean).filter(pth => !photoUrls[pth] || photoUrls[pth].exp < now + 60000);
  if (!paths.length) return;
  const { data, error } = await sb.storage.from('photos').createSignedUrls([...new Set(paths)], 3600);
  if (error) { console.error(error); return; }
  for (const r of data || []) if (r.signedUrl) photoUrls[r.path] = { url: r.signedUrl, exp: now + 3500 * 1000 };
  render();
}
const initials = n => String(n || '?').replace(/^(Ms|Mr|Mrs|Dr)\.?\s+/i, '').split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
function avatar(kind, id, size = 28) {
  const rec = kind === 'teacher' ? S.teachers[id] : S.students[id]; const name = kind === 'teacher' ? tname(id) : sname(id);
  const url = rec?.photo && photoUrls[rec.photo]?.url;
  const bg = kind === 'teacher' ? tcolor(id) : 'var(--accent-soft)'; const fg = kind === 'teacher' ? '#fff' : 'var(--accent)';
  return url ? `<img class="ava" src="${esc(url)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px" loading="lazy">`
    : `<span class="ava" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${bg};color:${fg}">${esc(initials(name))}</span>`;
}
function squareJpeg(file, px = 480) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = px;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, px, px); URL.revokeObjectURL(u);
      c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.85); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('That file is not an image we can read.')); };
    img.src = u;
  });
}
function pickPhoto(kind, id) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      toast('Uploading photo…');
      const blob = await squareJpeg(f);
      const path = `${kind}s/${id}/${Date.now()}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) { console.error(error); return toast(/row-level|403|Unauthorized/i.test(error.message) ? 'You do not have permission to change this photo.' : 'Could not upload the photo. Try again.'); }
      await run(sb.from(kind === 'teacher' ? 'teachers' : 'students').update({ photo: path }).eq('id', id), 'Photo updated');
      renderOverlay(true);
    } catch (e) { toast(e.message || 'Could not upload the photo.'); }
  };
  inp.click();
}
const canEditPhoto = (kind, id) => isAdmin() || (kind === 'teacher' && id === myTeacher());
function photoBlock(kind, id) {
  const rec = kind === 'teacher' ? S.teachers[id] : S.students[id]; const can = canEditPhoto(kind, id);
  return `<div class="photoblock">${avatar(kind, id, 72)}${can ? `<div class="row-end" style="justify-content:flex-start"><button class="btn sm" data-photo="${kind}|${esc(id)}">${rec?.photo ? 'Change photo' : 'Add photo'}</button>${rec?.photo ? `<button class="btn sm ghost" data-photo-rm="${kind}|${esc(id)}">Remove photo</button>` : ''}</div>` : ''}</div>`;
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-photo]'); if (a) { const [k, i] = a.dataset.photo.split('|'); return pickPhoto(k, i); }
  const r = e.target.closest('[data-photo-rm]'); if (r) { const [k, i] = r.dataset.photoRm.split('|'); confirmBox('Remove this photo? The old photo stays in storage and the change is recorded in History.', () => run(sb.from(k === 'teacher' ? 'teachers' : 'students').update({ photo: null }).eq('id', i), 'Photo removed').then(() => renderOverlay(true)), 'Remove'); }
});
function intlPhone(p) { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 8) d = '965' + d; return d.length >= 8 ? d : ''; }
function phoneLinks(p, big) {
  const d = intlPhone(p); if (!d) return esc(p || '–');
  return `<span class="phone"><span class="num">${esc(p)}</span><a class="pbtn" href="tel:+${d}" title="Call ${esc(p)}" aria-label="Call ${esc(p)}">📞${big ? ' Call' : ''}</a><a class="pbtn wa" href="https://wa.me/${d}" target="_blank" rel="noopener" title="WhatsApp ${esc(p)}" aria-label="WhatsApp ${esc(p)}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4 5.2 5.2 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>${big ? ' WhatsApp' : ''}</a></span>`;
}
function toast(msg, ms = 2800) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

function stats(p) {
  const log = p.log || []; let used = 0, owes = 0, mk = 0; const c = { present: 0, absent: 0, noshow: 0, cancelled: 0, makeup: 0 };
  // An extra lesson marked Present (on a day off the student's weekly timetable) also makes up a missed one.
  // A makeup or extra that is missed (Absent or Cancelled off the timetable) does not add another makeup: the original one is still owed.
  const slotDays = new Set(slotsOf(p.teacherId).filter(s => s.studentId === p.studentId).map(s => s.day));
  const offSlot = e => slotDays.size > 0 && !slotDays.has(wd(e.d));
  for (const e of log) { c[e.s] = (c[e.s] || 0) + 1; if (ST[e.s]?.counts) used++; if (ST[e.s]?.owes && !offSlot(e)) owes++; if (e.s === 'makeup' || (e.s === 'present' && !slotDays.has(wd(e.d)))) mk++; }
  const owed = Math.max(0, owes - mk); const total = Number(p.sessions) || 0; const left = total - used;
  const th = Number(S.settings.lowThreshold ?? 2);
  let state = 'active'; if (p.closed) state = 'closed'; else if (left <= 0) state = 'finished'; else if (left <= th) state = 'low';
  const last = log.length ? log.map(e => e.d).sort().at(-1) : null;
  const ended = !p.closed && !!p.end && p.end < kwToday();
  const paidSum = S.payments.filter(x => x.package_id === p.id && x.status === 'paid').reduce((a, x) => a + Number(x.amount), 0);
  return { used, owed, left, total, c, state, last, ended, paidSum };
}
const pkgRef = p => p?.ref ? 'PKG-' + String(p.ref).padStart(4, '0') : '';
const refTag = p => p?.ref ? `<span class="ref">${pkgRef(p)}</span>` : '';
const pkgList = () => Object.entries(S.packages).map(([id, p]) => ({ id, ...p }));
const pairPkgs = (sid, tid) => pkgList().filter(p => p.studentId === sid && p.teacherId === tid);
function pkgForDate(sid, tid, date) {
  const all = pairPkgs(sid, tid);
  const hit = all.find(p => (p.log || []).some(e => e.d === date)); if (hit) return hit;
  const covers = p => (!p.start || p.start <= date) && (!p.end || p.end >= date) && (!p.closed || (stats(p).last && stats(p).last >= date));
  const cov = all.filter(covers).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const covPick = cov.find(p => !p.closed && stats(p).left > 0) || cov.find(p => !p.closed) || cov.at(-1);
  if (covPick) return covPick;
  const open = all.filter(p => !p.closed).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return open.find(p => stats(p).left > 0) || open.at(-1) || null;
}
// Makeups owed on packages that were renewed (closed) with this teacher. They stay owed until made up.
const carriedOwed = (sid, tid) => pairPkgs(sid, tid).filter(p => p.closed && stats(p).owed > 0).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
// Where a makeup lesson should be logged: the oldest package that still owes one, even if it was renewed. Otherwise the usual package.
const makeupPkg = (sid, tid, date) => pairPkgs(sid, tid).filter(p => stats(p).owed > 0).sort((a, b) => (a.start || '').localeCompare(b.start || ''))[0] || pkgForDate(sid, tid, date);
// A makeup, or a lesson marked Present on a day off the weekly timetable, belongs on the oldest package that still owes a makeup.
const owingPkg = (sid, tid) => pairPkgs(sid, tid).filter(p => stats(p).owed > 0).sort((a, b) => (a.start || '').localeCompare(b.start || ''))[0] || null;
// Lessons that move to the new package on renewal: everything marked from its start date on (a missed first
// lesson then owes a makeup on the new package), plus lessons beyond the old package's size.
// Makeups stay with the package whose debt they cleared.
function renewMoves(old, start) {
  const ms = e => makesUp(old.studentId, old.teacherId, e.d, e.s);
  let keep = (old.log || []).filter(e => e.d < start || ms(e));
  for (const e of keep.filter(e => e.d >= start).sort((a, b) => b.d.localeCompare(a.d))) {
    const rest = keep.filter(x => x !== e);
    if (stats({ ...old, log: rest }).owed === stats({ ...old, log: keep }).owed) keep = rest;
  }
  const counted = keep.filter(e => ST[e.s]?.counts).sort((a, b) => a.d.localeCompare(b.d)); const total = Number(old.sessions) || 0;
  const extra = counted.length > total ? counted.slice(total).filter(e => !ms(e)) : [];
  return (old.log || []).filter(e => !keep.includes(e) || extra.includes(e)).map(e => e.id);
}
const isOneOffDay = (sid, tid, date) => { const days = slotsOf(tid).filter(x => x.studentId === sid).map(x => x.day); return days.length > 0 && !days.includes(wd(date)); };
const makesUp = (sid, tid, date, status) => status === 'makeup' || (status === 'present' && isOneOffDay(sid, tid, date));
const owedTotal = (sid, tid) => pairPkgs(sid, tid).reduce((a, p) => a + stats(p).owed, 0);
// A lesson's time: its own (one-off lessons), else the student's weekly time with the teacher on that weekday.
const lessonTime = (p, e) => { if (e.t) return `${fmtTs(e.t)}–${fmtT(toMin(e.t) + (e.du || defDur(p.studentId, p.teacherId)))}`; const sl = slotsOf(p.teacherId).find(x => x.studentId === p.studentId && x.day === wd(e.d)); return sl ? `${fmtTs(sl.start)}–${fmtT(toMin(sl.start) + sl.dur)}` : ''; };
const entryFor = (p, date) => p ? (p.log || []).find(e => e.d === date) : null;
const overlaps = (a, b) => a.day === b.day && toMin(a.start) < toMin(b.start) + b.dur && toMin(b.start) < toMin(a.start) + a.dur;
function studentSlots(sid) { const out = []; for (const t of teacherIds()) for (const s of slotsOf(t)) if (s.studentId === sid) out.push({ ...s, teacherId: t }); return out.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start)); }
const slotLabel = s => s.studentId ? sname(s.studentId) : (s.label || 'Reserved');
// Usual lesson length for a student with a teacher (from their weekly slot), used for one-off lessons.
const defDur = (sid, tid) => slotsOf(tid).find(s => s.studentId === sid)?.dur || 45;
// One-off lessons (makeups, extras) logged on a date, with their own time if one was set.
function datedLessons(tid, from, to) {
  const out = [];
  for (const p of pkgList()) if (p.teacherId === tid) for (const e of p.log || []) if (e.d >= from && e.d <= to && !slotsOf(tid).some(s => s.studentId === p.studentId && s.day === wd(e.d))) out.push({ p, e, dur: e.du || defDur(p.studentId, tid) });
  return out.sort((a, b) => a.e.d.localeCompare(b.e.d) || (a.e.t || '99').localeCompare(b.e.t || '99'));
}
const weekOf = d => addDays(d, -wd(d));
// A weekly lesson is free on a date when its student was marked absent or the teacher cancelled.
function slotOffOn(tid, s, date) { if (!s.studentId) return null; const e = entryFor(pkgForDate(s.studentId, tid, date), date); return e && !ST[e.s]?.counts ? e : null; }
// Everything a teacher has on a date: weekly lessons and breaks (unless freed that day) and timed one-off lessons.
function busyOn(tid, date, skipId) {
  const w = wd(date); const out = [];
  for (const s of slotsOf(tid)) if (s.day === w && !slotOffOn(tid, s, date)) out.push({ tid, start: toMin(s.start), end: toMin(s.start) + s.dur, sid: s.studentId, what: s.studentId ? sname(s.studentId) : (s.label || 'Reserved') });
  for (const x of datedLessons(tid, date, date)) if (x.e.t && x.e.id !== skipId) out.push({ tid, start: toMin(x.e.t), end: toMin(x.e.t) + x.dur, sid: x.p.studentId, what: `${sname(x.p.studentId)} (${x.p.kind === 'trial' ? 'trial' : x.e.s === 'makeup' ? 'makeup' : 'extra'})` });
  return out.sort((a, b) => a.start - b.start);
}
// What a one-off lesson at this time would overlap: the teacher's other lessons, and the student's lessons with other teachers.
function clashesFor(tid, sid, date, time, dur, skipId) {
  const a = toMin(time), b = a + dur; const hit = x => x.start < b && a < x.end;
  const teacher = busyOn(tid, date, skipId).filter(hit);
  const student = sid ? teacherIds().filter(x => x !== tid).flatMap(x => busyOn(x, date, skipId)).filter(x => x.sid === sid && hit(x)) : [];
  return teacher.concat(student);
}
const clashText = (list, tid) => list.map(x => x.tid === tid ? `${tname(x.tid)} already has ${x.what} ${fmtTs(x.start)}–${fmtT(x.end)}` : `${sname(x.sid)} already has a lesson with ${tname(x.tid)} ${fmtTs(x.start)}–${fmtT(x.end)}`).join('; ');
// Open stretches in a teacher's day long enough for a lesson of this length.
function freeGaps(tid, date, dur) {
  const busy = busyOn(tid, date); const hi = Math.max(20 * 60, ...busy.map(x => x.end)); const gaps = [];
  let cur = Math.min(14 * 60, ...busy.map(x => x.start));
  for (const x of busy) { if (x.start - cur >= dur) gaps.push([cur, x.start]); cur = Math.max(cur, x.end); }
  if (hi - cur >= dur) gaps.push([cur, hi]);
  return gaps;
}
function conflictsFor(tid, slot) {
  const res = { teacher: [], student: [] };
  for (const s of slotsOf(tid)) if (s.id !== slot.id && overlaps(s, slot)) res.teacher.push(s);
  if (slot.studentId) for (const t of teacherIds()) for (const s of slotsOf(t)) if (s.id !== slot.id && s.studentId === slot.studentId && overlaps(s, slot)) res.student.push({ ...s, teacherId: t });
  return res;
}

/* ---------- data: load + realtime ---------- */
let loadSeq = 0;
async function loadAll() {
  const seq = ++loadSeq;
  const q = await Promise.all([
    sb.from('teachers').select('*'), sb.from('students').select('*'), sb.from('packages').select('*'),
    sb.from('lessons').select('id,package_id,lesson_date,status,note,start_time,dur'), sb.from('slots').select('*'),
    sb.from('settings').select('*').maybeSingle(),
    isAdmin() ? sb.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] }),
    isAdmin() ? sb.from('payments').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const ex = isAdmin() ? await sb.from('expenses').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }) : { data: [] };
  if (ex.error) console.error(ex.error);
  if (seq !== loadSeq) return;
  const bad = q.find(r => r.error); if (bad) { console.error(bad.error); toast('Could not load the studio data. Refresh to try again.'); return; }
  const [t, s, p, l, sl, st, pr, pay] = q.map(r => r.data);
  const teachers = {};
  for (const r of t) teachers[r.id] = { name: r.name, subjects: r.subjects, color: r.color, notes: r.notes, order: r.sort_order, photo: r.photo, slots: [] };
  for (const r of sl) teachers[r.teacher_id]?.slots.push({ id: r.id, day: r.day, start: r.start_time, dur: r.dur, studentId: r.student_id, label: r.label, status: r.status, note: r.note });
  const students = {};
  for (const r of s) students[r.id] = { name: r.name, guardian: r.guardian, phone: r.phone, regForm: r.reg_form, notes: r.notes, archived: r.archived, photo: r.photo };
  const packages = {};
  for (const r of p) packages[r.id] = { studentId: r.student_id, teacherId: r.teacher_id, subject: r.subject, kind: r.kind, sessions: r.sessions, perWeek: r.per_week, start: r.start_date, end: r.end_date, term: r.term, payment: r.payment, paidNote: r.paid_note, price: r.price, notes: r.notes, closed: r.closed, ref: r.ref, log: [] };
  for (const r of l) packages[r.package_id]?.log.push({ id: r.id, d: r.lesson_date, s: r.status, n: r.note, t: r.start_time || null, du: r.dur || null });
  for (const k in packages) packages[k].log.sort((a, b) => a.d.localeCompare(b.d));
  Object.assign(S, { teachers, students, packages, profiles: pr || [], payments: pay || [], expenses: ex.error ? null : ex.data || [], loaded: true });
  if (st) S.settings = { schoolName: st.school_name, term: st.term, lowThreshold: st.low_threshold, phone: st.phone || '', instagram: st.instagram || '' };
  render();
  refreshPhotoUrls();
}
let reloadTimer = null; let channel = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { loadAll(); if (S.tab === 'history' && isAdmin() && S.hist.rows.length <= 200) loadHistory(true); if (tl.key && drawer && (drawer.type === 'student' || drawer.type === 'package') && isAdmin()) { const [k, i] = tl.key.split('|'); loadTimeline(k, i); } }, 350); };
function subscribe() {
  if (channel) return;
  channel = sb.channel('studio').on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload).subscribe();
}

/* ---------- writes ---------- */
async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) { console.error(error); toast(/Past attendance is locked|reason is required/i.test(error.message) ? error.message : error.code === 'PGRST202' ? 'This action is not set up yet. Ask the admin to finish the database setup.' : error.code === '42501' || /row-level security/i.test(error.message) ? 'You do not have permission to make this change.' : error.code === '23505' ? 'That already exists.' : error.code === '23503' ? 'This is still used elsewhere. Remove those records first.' : 'Could not save. Check your connection and try again.'); await loadAll(); throw error; }
  if (okMsg) toast(okMsg);
  await loadAll();
}
const pkgCols = { teacherId: 'teacher_id', studentId: 'student_id', subject: 'subject', kind: 'kind', sessions: 'sessions', perWeek: 'per_week', start: 'start_date', end: 'end_date', term: 'term', payment: 'payment', paidNote: 'paid_note', price: 'price', notes: 'notes', closed: 'closed' };
const toRow = (patch, map) => { const o = {}; for (const k in patch) if (map[k]) o[map[k]] = patch[k] === '' && (k === 'start' || k === 'end') ? null : patch[k]; return o; };
const savePkg = (id, patch, msg) => run(sb.from('packages').update(toRow(patch, pkgCols)).eq('id', id), msg);
async function setLog(pid, date, status, note, time, dur) {
  const e = entryFor(S.packages[pid], date);
  if (status == null) { if (e) await run(sb.from('lessons').delete().eq('id', e.id)); return; }
  if (e) {
    const p = S.packages[pid]; const patch = note != null ? { status, note } : { status };
    if (makesUp(p.studentId, p.teacherId, date, status) && !stats(p).owed) { const home = owingPkg(p.studentId, p.teacherId); if (home && home.id !== pid) patch.package_id = home.id; }
    return run(sb.from('lessons').update(patch).eq('id', e.id), patch.package_id ? `Counted as the makeup owed on ${pkgRef(S.packages[patch.package_id]) || 'the previous package'}` : '');
  }
  return run(sb.from('lessons').insert({ package_id: pid, lesson_date: date, status, note: note || '', start_time: time || null, dur: time ? dur || null : null }));
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
  if (S.session) w.innerHTML = `<span title="${esc(S.session.user.email)}">${esc(S.me ? (S.me.role === 'admin' ? (myTeacher() ? `${tname(myTeacher())} · Super admin` : 'Super admin') : S.me.role === 'teacher' && myTeacher() ? tname(myTeacher()) : S.session.user.email) : S.session.user.email)}</span><button class="btn sm ghost" id="signOut" title="Signed in as ${esc(S.session.user.email)}">Sign out</button>`;
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
    if (p.closed) { const s = stats(p); if (s.owed > 0 && pk.some(o => !o.closed && o.studentId === p.studentId && o.teacherId === p.teacherId)) owed.push([p, s]); continue; }
    const s = stats(p);
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
      const started = all.some(p => p.start && p.start <= d && (!p.end || p.end >= d) && !(p.closed && (!stats(p).last || stats(p).last < d))); if (!started) continue;
      if (all.some(p => entryFor(p, d))) continue;
      unmarked.push({ d, t, sid: sl.studentId, start: sl.start });
    }
  }
  unmarked.sort((a, b) => a.d.localeCompare(b.d) || a.start.localeCompare(b.start));
  const noPkg = [], noSlot = [];
  for (const t of teacherIds()) for (const sl of slotsOf(t)) if (sl.studentId && sl.status !== 'blocked' && !pairPkgs(sl.studentId, t).some(p => !p.closed)) noPkg.push([sl, t]);
  for (const p of pk) if (!p.closed && p.kind !== 'trial' && !slotsOf(p.teacherId).some(sl => sl.studentId === p.studentId)) noSlot.push(p);
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
  add(owed.length, 'vio', 'Makeup lessons owed', pk2(owed, (p, s) => `${s.owed} owed${p.closed ? ` from the previous package ${pkgRef(p)}` : ''}`));
  add(unpaid.length, 'bad', 'Payment outstanding', pk2(unpaid, p => esc(PAY[p.payment]?.[0] || p.payment)));
  add(noPkg.length, 'warn', 'On the timetable with no open package', noPkg.map(([sl, t]) => `<li>${esc(sname(sl.studentId))} · ${esc(tname(t))} · ${DS[sl.day]} ${fmtT(sl.start)}${isAdmin() ? ` <a data-new-pkg="${esc(sl.studentId)}|${esc(t)}">add package</a>` : ''}</li>`).join(''));
  const trialNoTime = pk.filter(p => !p.closed && p.kind === 'trial' && !(p.log || []).length);
  add(trialNoTime.length, 'warn', 'Trial with no date and time booked', trialNoTime.map(p => `<li><a data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a> · ${esc(tname(p.teacherId))}${isAdmin() ? ` <a data-book-trial="${esc(p.id)}">book time</a>` : ''}</li>`).join(''));
  add(noSlot.length, 'blue', 'Open package but no weekly time', noSlot.map(p => `<li><a data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a> · ${esc(tname(p.teacherId))}</li>`).join(''));
  add(tent.length, 'warn', 'Times not confirmed yet', tent.map(([sl, t]) => `<li>${esc(slotLabel(sl))} · ${esc(tname(t))} · ${DS[sl.day]} ${fmtT(sl.start)}</li>`).join(''));
  add(forms.length, 'blue', 'Registration forms not signed', forms.map(id => `<li><a data-open-stu="${esc(id)}">${esc(sname(id))}</a> · ${esc(FORM[S.students[id].regForm]?.[0] || '')}</li>`).join(''));
  return items;
}
const isPast = d => d < kwToday();
// unmark: what pressing the selected button again sets (default: remove the mark). A booked makeup goes back to booked.
function segButtons(pid, d, cur, keys, unmark) {
  const locked = cur && isPast(d);
  const lockTitle = isAdmin() ? 'Past attendance is locked. Click to correct it with a reason.' : 'Past attendance is locked. Ask a super admin to correct it.';
  return `<div class="seg ${locked ? 'locked' : ''}" role="group" aria-label="Attendance" ${locked ? `title="${esc(lockTitle)}"` : ''}>${locked ? '<span class="lockico" aria-hidden="true">🔒</span>' : ''}${keys.map(k => `<button data-mark="${esc(pid)}|${d}|${k}${unmark ? '|' + unmark : ''}" class="${cur === k ? 'on-' + k : ''}" aria-pressed="${cur === k}" ${locked && !isAdmin() ? 'disabled' : ''}>${ST[k].seg}</button>`).join('')}</div>`;
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
      if (!s.studentId) return [toMin(s.start), `<div class="lesson blocked"><span class="time">${fmtTs(s.start)}–${fmtTs(end)}</span><span>${esc(s.label || 'Reserved')}${s.status === 'tentative' ? ' · not confirmed' : ''}</span><span></span></div>`];
      const p = pkgForDate(s.studentId, t, d); const e = entryFor(p, d); const st = p ? stats(p) : null;
      const info = p ? `${KINDS[p.kind] || ''} · ${st.used} of ${st.total} used${st.left <= 0 ? ' · <span style="color:var(--bad)">finished</span>' : st.state === 'low' ? ` · <span style="color:var(--warn)">${st.left} left</span>` : ''}${owedTotal(s.studentId, t) ? ` · ${owedTotal(s.studentId, t)} makeup owed` : ''}` : '<span style="color:var(--bad)">No open package</span>';
      const seg = p ? segButtons(p.id, d, e?.s, ['present', 'absent', 'noshow', 'cancelled']) : (isAdmin() ? `<button class="btn sm" data-new-pkg="${esc(s.studentId)}|${esc(t)}">Add package</button>` : '<span></span>');
      return [toMin(s.start), `<div class="lesson"><span class="time">${fmtTs(s.start)}–${fmtTs(end)}</span><div class="who"><b class="namecell">${avatar('student', s.studentId, 26)}<a style="color:inherit;cursor:pointer" ${p ? `data-open-pkg="${esc(p.id)}"` : `data-open-stu="${esc(s.studentId)}"`}>${esc(sname(s.studentId))}</a></b>${s.status === 'tentative' ? ' <span class="pill warn">not confirmed</span>' : ''}<span class="small muted">${info}${e?.n ? ` · ${esc(e.n)}` : ''}</span></div>${seg}</div>`];
    });
    rows = rows.concat(extras.map(p => { const e = entryFor(p, d); const st = stats(p); const du = e.du || defDur(p.studentId, t); return [e.t ? toMin(e.t) : 24 * 60, `<div class="lesson"><span class="time">${e.t ? `${fmtTs(e.t)}–${fmtTs(toMin(e.t) + du)}` : 'extra'}</span><div class="who"><b class="namecell">${avatar('student', p.studentId, 26)}<a style="color:inherit;cursor:pointer" data-open-pkg="${esc(p.id)}">${esc(sname(p.studentId))}</a></b> ${p.kind === 'trial' ? `<span class="pill blue">${isPast(d) ? 'Trial lesson' : 'Trial booked'}</span>` : e.s === 'makeup' ? `<span class="pill blue">${isPast(d) ? 'Makeup' : 'Makeup booked'}</span>` : '<span class="pill">Makeup or extra</span>'}<span class="small muted">${st.used} of ${st.total} used${e.n ? ` · ${esc(e.n)}` : ''}</span>${(e.s === 'makeup' || p.kind === 'trial') && !isPast(d) ? `<button class="btn sm ghost" style="margin-top:4px" data-resched="${esc(p.id)}|${esc(e.id)}">↻ Reschedule</button>` : ''}</div>${segButtons(p.id, d, e.s, ['present', 'absent', 'noshow', 'cancelled'], p.kind === 'trial' ? 'present' : 'makeup')}</div>`]; })).sort((a, b) => a[0] - b[0]).map(r => r[1]).join('');
    body += `<section class="tgroup"><h3>${avatar('teacher', t, 30)}${esc(tname(t))}</h3><div class="card">${rows}</div></section>`;
  }
  if (!any) body = `<div class="card empty">No lessons on the timetable for ${DAYS[w]}s.<br><span class="small">Use “Log makeup or extra” to record a lesson on this day.</span></div>`;
  const items = attention();
  const attn = items.length ? items.map(it => `<div class="attn-item"><span class="n pill ${it.tone}">${it.n}</span><details><summary>${esc(it.title)}</summary><ul>${it.list}</ul></details></div>`).join('') : '<p class="muted small">Nothing needs attention.</p>';
  $('#view').innerHTML = `
  <div class="bar"><div class="daynav"><span class="big">${isToday ? 'Today' : esc(DAYS[w])}</span><span class="muted">${esc(fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
   <span style="margin-left:auto" class="daynav"><button class="btn sm" data-day="-1" aria-label="Previous day">‹ Prev</button><input type="date" id="daypick" value="${d}" aria-label="Date"><button class="btn sm" data-day="1" aria-label="Next day">Next ›</button>${isToday ? '' : '<button class="btn sm" data-day="0">Today</button>'}${isAdmin() ? '<button class="btn sm" id="bookTrial">Book trial</button>' : ''}<button class="btn primary sm" id="logExtra">Log makeup or extra</button></span></div>
  <div class="layout-today"><div>${body}</div><aside class="card attn"><h3>Needs attention</h3>${attn}</aside></div>`;
  $('#daypick').onchange = e => { if (e.target.value) { S.date = e.target.value; render(); } };
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { const n = +b.dataset.day; S.date = n === 0 ? kwToday() : addDays(S.date, n); render(); });
  $('#logExtra').onclick = () => openModal('extra', { date: d });
  if ($('#bookTrial')) $('#bookTrial').onclick = () => openModal('trial', { date: isPast(d) ? kwToday() : d });
}

/* ---------- WEEK ---------- */
function renderWeek() {
  const tids = isAdmin() ? teacherIds() : teacherIds().filter(x => x === myTeacher());
  if (!S.weekTeacher || !S.teachers[S.weekTeacher]) S.weekTeacher = myTeacher() && S.teachers[myTeacher()] ? myTeacher() : tids[0];
  const t = S.weekTeacher; const slots = slotsOf(t); const editable = canEditSlots(t);
  if (!t) { $('#view').innerHTML = '<div class="card empty">No teachers yet.</div>'; return; }
  const today = kwToday(); const ws = S.weekStart || weekOf(today); const dateOf = d => addDays(ws, d);
  const once = datedLessons(t, ws, addDays(ws, 6)); const timed = once.filter(x => x.e.t);
  const days = [0, 1, 2, 3, 4, 6].concat(slots.some(s => s.day === 5) || timed.some(x => wd(x.e.d) === 5) ? [5] : []).sort((a, b) => a - b);
  let lo = 14 * 60, hi = 20 * 60; for (const s of slots) { lo = Math.min(lo, toMin(s.start)); hi = Math.max(hi, toMin(s.start) + s.dur); }
  for (const x of timed) { lo = Math.min(lo, toMin(x.e.t)); hi = Math.max(hi, toMin(x.e.t) + x.dur); }
  const offOn = (s, date) => slotOffOn(t, s, date);
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60; const rows = (hi - lo) / 15;
  const conflictIds = new Set();
  for (const s of slots) { const c = conflictsFor(t, s); if (c.teacher.length || c.student.length) conflictIds.add(s.id); }
  let g = '<div class="hd"></div>' + days.map((d, i) => `<div class="hd${dateOf(d) === today ? ' now' : ''}" style="grid-column:${i + 2};grid-row:1">${DAYS[d]}<span class="hdd">${esc(chipD(dateOf(d)))}</span></div>`).join('');
  for (let r = 0; r < rows; r++) {
    const m = lo + r * 15;
    if (m % 60 === 0) g += `<div class="tm" style="grid-column:1;grid-row:${r + 2}">${fmtT(m).replace(':00', '')}</div>`;
    days.forEach((d, i) => { g += editable ? `<button class="cell${m % 60 === 0 ? ' hr' : ''}" style="grid-column:${i + 2};grid-row:${r + 2}" data-add-slot="${d}|${toT(m)}" aria-label="Add lesson ${DAYS[d]} ${fmtT(m)}"></button>` : `<div class="cell${m % 60 === 0 ? ' hr' : ''}" style="grid-column:${i + 2};grid-row:${r + 2};cursor:default"></div>`; });
  }
  for (const s of slots) {
    const i = days.indexOf(s.day); if (i < 0) continue;
    const r0 = (toMin(s.start) - lo) / 15 + 2; const span = Math.max(1, Math.round(s.dur / 15));
    const off = offOn(s, dateOf(s.day));
    const cls = ['blk', s.status !== 'confirmed' ? s.status : '', conflictIds.has(s.id) ? 'conflict' : '', span === 1 ? 'short' : '', off ? 'off' : ''].join(' ');
    const pk = s.studentId ? pkgForDate(s.studentId, t, kwToday()) : null; const st = pk ? stats(pk) : null;
    const flag = off ? (ST[off.s]?.seg || off.s).toLowerCase() : s.studentId && !pk ? 'no package' : st && st.state === 'finished' ? 'finished' : st && st.state === 'low' ? `${st.left} left` : '';
    g += `<button class="${cls}" style="grid-column:${i + 2};grid-row:${Math.floor(r0)} / span ${span};background:${esc(tcolor(t))};color:#fff" data-edit-slot="${esc(s.id)}" title="${esc(slotLabel(s) + ' ' + fmtT(s.start) + (off ? ` — ${ST[off.s]?.label || off.s} on ${fmtD(off.d)}` : '') + (s.note ? ' — ' + s.note : ''))}">${span === 1 ? `<span class="one"><b>${s.status === 'blocked' && /break/i.test(s.label || '') ? '☕ ' : ''}${esc(slotLabel(s))}</b> <span class="bt">${fmtTs(s.start)}–${fmtTs(toMin(s.start) + s.dur)}</span></span>` : `<span class="bt">${fmtTs(s.start)}–${fmtTs(toMin(s.start) + s.dur)}</span><b>${esc(slotLabel(s))}</b>${span > 2 && flag ? `<span class="bt">${esc(flag)}</span>` : ''}`}</button>`;
  }
  for (const x of timed) {
    const d = wd(x.e.d); const i = days.indexOf(d); if (i < 0) continue;
    const r0 = (toMin(x.e.t) - lo) / 15 + 2; const span = Math.max(1, Math.round(x.dur / 15));
    const clashes = clashesFor(t, x.p.studentId, x.e.d, x.e.t, x.dur, x.e.id); const clash = clashes.length > 0;
    const kind = x.p.kind === 'trial' ? 'Trial' : x.e.s === 'makeup' ? 'Makeup' : ST[x.e.s]?.seg || 'Extra'; const tm = `${fmtTs(x.e.t)}–${fmtTs(toMin(x.e.t) + x.dur)}`;
    g += `<button class="blk once ${clash ? 'conflict' : ''} ${span === 1 ? 'short' : ''}" style="grid-column:${i + 2};grid-row:${Math.floor(r0)} / span ${span}" data-open-pkg="${esc(x.p.id)}" title="${esc(`${kind}: ${sname(x.p.studentId)}, ${fmtD(x.e.d)} ${fmtT(x.e.t)}${x.e.n ? ' — ' + x.e.n : ''}${clash ? ' — Clash: ' + clashText(clashes, t) : ''}`)}">${span === 1 ? `<span class="one"><b>${esc(kind)} · ${esc(sname(x.p.studentId))}</b> <span class="bt">${tm}</span></span>` : `<span class="bt">${tm} · ${esc(kind)}</span><b>${esc(sname(x.p.studentId))}</b>`}</button>`;
  }
  const onceList = once.length ? `<div class="card" style="padding:12px 14px;margin-top:16px"><div class="eyebrow">Trials, makeups and extra lessons this week</div><ul class="small" style="margin:6px 0 0;padding-left:18px">${once.map(x => `<li><a data-goto-date="${x.e.d}">${esc(fmtD(x.e.d))}</a> · ${x.e.t ? `${fmtT(x.e.t)}–${fmtT(toMin(x.e.t) + x.dur)}` : '<span style="color:var(--warn)">no time set</span>'} · <a data-open-pkg="${esc(x.p.id)}">${esc(sname(x.p.studentId))}</a> · ${esc(ST[x.e.s]?.label || x.e.s)}${x.e.n ? ` · ${esc(x.e.n)}` : ''}${x.e.s === 'makeup' && !isPast(x.e.d) ? ` · <a data-resched="${esc(x.p.id)}|${esc(x.e.id)}">Reschedule</a>` : ''}</li>`).join('')}</ul></div>` : '';
  // Teaching time = every slot that is not a break/unavailable (lessons, group classes, reserved slots).
  // Overlapping slots are merged so clashes are not counted twice. Unconfirmed slots are reported separately.
  const unionMin = list => { const iv = list.map(x => [toMin(x.start), toMin(x.start) + x.dur]).sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1; for (const [a, b] of iv) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); } if (ce > cs) tot += ce - cs; return tot; };
  const teach = slots.filter(x => x.status !== 'blocked');
  const conf = teach.filter(x => x.status === 'confirmed'), tent = teach.filter(x => x.status === 'tentative');
  const hrs = m => { const h = Math.floor(m / 60), mm = m % 60; return h && mm ? `${h} h ${mm} min` : h ? `${h} h` : `${mm} min`; };
  const dayCards = days.filter(d => d !== 5 || teach.some(x => x.day === 5)).map(d => {
    const dc = conf.filter(x => x.day === d), dt = tent.filter(x => x.day === d);
    if (!dc.length && !dt.length) return `<div class="card"><b>${DAYS[d]}</b><span class="small muted">No teaching</span></div>`;
    const all = dc.concat(dt); const first = Math.min(...all.map(x => toMin(x.start))), last = Math.max(...all.map(x => toMin(x.start) + x.dur));
    const tm = unionMin(dc), tt = unionMin(dc.concat(dt)) - tm;
    return `<div class="card"><b>${DAYS[d]}</b><div class="num" style="font-size:18px">${dc.length ? hrs(tm) : '0 h'}</div><span class="small muted">${dc.length} lesson${dc.length === 1 ? '' : 's'} · ${fmtTs(first)}–${fmtT(last)}</span>${tt ? `<div class="small" style="color:var(--warn)">+ ${hrs(tt)} not confirmed</div>` : ''}</div>`;
  }).join('');
  const weekConf = days.reduce((a, d) => a + unionMin(conf.filter(x => x.day === d)), 0);
  const weekAll = days.reduce((a, d) => a + unionMin(teach.filter(x => x.day === d)), 0);
  $('#view').innerHTML = `
  <div class="bar"><h2>Timetable</h2><div class="tchips">${tids.map(id => `<button class="tchip" aria-pressed="${id === t}" data-wt="${esc(id)}">${avatar('teacher', id, 24)}${esc(tname(id))}</button>`).join('')}</div></div>
  <div class="bar daynav"><span class="big">${ws === weekOf(today) ? 'This week' : 'Week of ' + esc(fmtD(ws, { day: 'numeric', month: 'long' }))}</span><span class="muted">${esc(fmtD(ws, { day: 'numeric', month: 'short' }))} – ${esc(fmtD(addDays(ws, 6), { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
   <span style="margin-left:auto" class="daynav"><button class="btn sm" data-wk="-1" aria-label="Previous week">‹ Prev</button><input type="date" id="wkpick" value="${ws}" aria-label="Week"><button class="btn sm" data-wk="1" aria-label="Next week">Next ›</button>${ws === weekOf(today) ? '' : '<button class="btn sm" data-wk="0">This week</button>'}${isAdmin() ? '<button class="btn sm" id="wkTrial">Book trial</button>' : ''}<button class="btn primary sm" id="wkLog">Log makeup or extra</button></span></div>
  <p class="muted small" style="margin:-6px 0 12px"><b style="color:var(--ink)">${hrs(weekConf)}</b> teaching a week · ${conf.length} weekly lessons${weekAll > weekConf ? ` · <span style="color:var(--warn)">+ ${hrs(weekAll - weekConf)} not confirmed</span>` : ''}.${editable ? ' Click an empty time to add a lesson; click a lesson to change or remove it.' : ''}</p>
  <div class="wk-wrap"><div class="wk" style="grid-template-columns:62px repeat(${days.length},minmax(104px,1fr));grid-template-rows:auto repeat(${rows},var(--row))">${g}</div></div>
  <div class="legend"><span><i class="sw" style="background:${esc(tcolor(t))}"></i>Confirmed</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--warn-soft) 0 4px,var(--surface) 4px 7px);outline:1px dashed var(--warn)"></i>Not confirmed</span><span><i class="sw" style="background:var(--brk-bg);border-left:3px solid var(--gold)"></i>Break or unavailable</span><span><i class="sw" style="background:var(--blue)"></i>Makeup or extra (this date only)</span><span><i class="sw" style="background:var(--muted);opacity:.45"></i>Absent or cancelled this week</span><span><i class="sw" style="outline:2px solid var(--bad)"></i>Clash</span></div>
  ${onceList}
  ${S.teachers[t]?.notes ? `<div class="card" style="padding:12px 14px;margin-top:16px"><div class="eyebrow">Notes and requests</div><div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(S.teachers[t].notes)}</div></div>` : ''}
  <h3 style="margin-top:22px;font-size:16px">Teaching hours</h3><p class="small muted" style="margin:2px 0 8px">Lessons, group classes and reserved slots. Breaks and unavailable times are not counted.</p><div class="gaps">${dayCards}<div class="card" style="border-color:var(--gold)"><b>Week</b><div class="num" style="font-size:18px">${hrs(weekConf)}</div><span class="small muted">${conf.length} lessons</span>${weekAll > weekConf ? `<div class="small" style="color:var(--warn)">+ ${hrs(weekAll - weekConf)} not confirmed</div>` : ''}</div></div>`;
  document.querySelectorAll('[data-wt]').forEach(b => b.onclick = () => { S.weekTeacher = b.dataset.wt; render(); });
  document.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => { const n = +b.dataset.wk; S.weekStart = n === 0 ? null : addDays(ws, 7 * n); render(); });
  $('#wkpick').onchange = e => { if (e.target.value) { S.weekStart = weekOf(e.target.value); render(); } };
  $('#wkLog').onclick = () => openModal('extra', { date: ws <= today && today <= addDays(ws, 6) ? today : ws, teacherId: t });
  if ($('#wkTrial')) $('#wkTrial').onclick = () => openModal('trial', { date: ws <= today && today <= addDays(ws, 6) ? today : ws < today ? today : ws, teacherId: t });
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
  list = list.filter(({ p, s }) => (f.teacher === 'all' || p.teacherId === f.teacher) && (!q || (sname(p.studentId) + ' ' + pkgRef(p)).toLowerCase().includes(q)) && (
    f.state === 'all' || (f.state === 'active' && !p.closed) || (f.state === 'closed' && p.closed) || (f.state === 'attention' && !p.closed && (s.state !== 'active' || s.owed || p.payment !== 'paid' || s.ended)) || (f.state === 'ended' && s.ended) ||
    (f.state === 'owed' && s.owed > 0) || (f.state === 'unpaid' && p.payment !== 'paid' && !p.closed) || (f.state === 'low' && !p.closed && (s.state === 'low' || s.state === 'finished'))));
  list.sort((a, b) => tname(a.p.teacherId).localeCompare(tname(b.p.teacherId)) || sname(a.p.studentId).localeCompare(sname(b.p.studentId)));
  const rows = list.map(({ p, s }) => `<tr data-open-pkg="${esc(p.id)}"><td><div class="namecell">${avatar('student', p.studentId, 30)}<div><b>${esc(sname(p.studentId))}</b><div class="small muted">${refTag(p)} ${esc(KINDS[p.kind] || p.kind)} · ${p.perWeek || 1}× a week${p.subject ? ' · ' + esc(p.subject) : ''}${p.end ? ` · <span style="${s.ended ? 'color:var(--bad)' : ''}">${s.ended ? 'ended' : 'ends'} ${esc(chipD(p.end))}</span>` : ''}</div></div></div></td>
   <td><span class="dot" style="background:${esc(tcolor(p.teacherId))}"></span> ${esc(tname(p.teacherId))}</td><td>${meter(s)}</td>
   <td class="num">${s.left < 0 ? `<span style="color:var(--bad)">${s.left}</span>` : s.left}</td>
   <td>${s.owed ? `<span class="pill vio">${s.owed} owed</span>` : '<span class="muted">–</span>'}</td>
   <td>${p.closed ? '<span class="pill">Closed</span>' : s.state === 'finished' ? '<span class="pill bad">Finished</span>' : s.state === 'low' ? '<span class="pill warn">Nearly done</span>' : '<span class="pill ok">Active</span>'}</td>
   <td><span class="pill ${PAY[p.payment]?.[1] || ''}">${esc(PAY[p.payment]?.[0] || '–')}</span></td><td>${chips(p)}</td></tr>`).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Attendance</h2>${isAdmin() ? '<button class="btn primary" id="newPkg">New package</button>' : ''}</div>
  <div class="filters" style="margin-bottom:12px">
   <input type="search" id="pq" placeholder="Search student or PKG ref" value="${esc(f.q)}" aria-label="Search student or package reference">
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
    return `<tr data-open-stu="${esc(id)}"><td><div class="namecell">${avatar('student', id, 30)}<div><b>${esc(s.name)}</b>${s.notes ? `<div class="small muted" style="max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.notes)}</div>` : ''}</div></div></td><td>${esc(s.guardian || '–')}</td><td class="mono small">${phoneLinks(s.phone)}</td>
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
    <label class="f">Studio phone <span class="muted small">(on parent reports and receipts)</span><input type="tel" id="setPhone" placeholder="+965 …" value="${esc(st.phone || '')}"></label>
    <label class="f">Instagram <span class="muted small">(on parent reports and receipts)</span><input type="text" id="setIg" placeholder="ariamusicacademy.kw" value="${esc(st.instagram || '')}"></label>
  </div><div class="row-end" style="margin-top:12px"><button class="btn primary" id="saveSet">Save settings</button></div></section>
  <div class="bar"><h2 style="font-size:20px">Teachers</h2><button class="btn" id="addT">Add teacher</button></div>
  <div class="teachers-list">${teacherIds().map(id => {
    const t = S.teachers[id]; const n = slotsOf(id).filter(s => s.studentId).length; const np = pkgList().filter(p => p.teacherId === id && !p.closed).length;
    return `<div class="card" data-tcard="${esc(id)}">${photoBlock('teacher', id)}<div style="display:flex;gap:10px;align-items:center"><input type="color" value="${esc(t.color || '#447799')}" data-tf="color" aria-label="Colour" style="width:34px;height:30px;border:0;padding:0;background:none"><input type="text" value="${esc(t.name)}" data-tf="name" aria-label="Name" style="flex:1;font-weight:600"></div>
    <label class="f">Instruments or subjects<input type="text" value="${esc(t.subjects || '')}" data-tf="subjects" placeholder="Piano, Vocal"></label>
    <label class="f">Notes and requests<textarea data-tf="notes">${esc(t.notes || '')}</textarea></label>
    <div class="row-end"><span class="small muted" style="margin-right:auto">${n} weekly lessons · ${np} open packages</span><button class="btn sm primary" data-save-t="${esc(id)}">Save</button></div></div>`;
  }).join('')}</div>
  <section style="margin-top:26px"><h2 style="font-size:20px;margin-bottom:10px">How lessons are counted</h2><div class="howto card" style="padding:16px">
   <p><b>Present</b> and <b>Makeup lesson</b> use one lesson from the package.</p>
   <p><b>No-show</b> uses a lesson. Use it when the student missed without notice and gets no makeup.</p>
   <p><b>Absent</b> does not use a lesson. It adds one makeup owed. When the makeup happens, log it as a Makeup lesson (or mark an extra lesson off the weekly timetable as Present) and the debt clears.</p>
   <p><b>Teacher cancelled</b> works like Absent: no lesson used, one makeup owed.</p>
   <p>If a scheduled makeup does not happen, mark it <b>Absent</b> (or <b>Teacher cancelled</b>). No lesson is used and the original makeup stays owed, so you can book it again. To move an upcoming makeup to another day or time, use <b>Reschedule</b> on Today or in the week's makeup list.</p>
   <p><b>Left</b> = package size minus lessons used. A package shows as nearly done at the warning level above and finished at zero.</p>
   <p>Renewing a package closes the old one and starts a new one, so history is kept.</p>
  </div></section>`;
  $('#saveSet').onclick = () => run(sb.from('settings').upsert({ id: 1, school_name: $('#setName').value.trim() || 'Studio Desk', term: $('#setTerm').value.trim(), low_threshold: Math.max(0, +$('#setLow').value || 0), phone: $('#setPhone').value.trim(), instagram: igHandle($('#setIg').value) }), 'Settings saved').catch(() => {});
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
// Accepts "@name", "name" or an instagram.com link; stores just the handle.
const igHandle = v => String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '');
const contactLine = () => [S.settings.phone ? `Call / WhatsApp ${S.settings.phone}` : '', S.settings.instagram ? `Instagram @${igHandle(S.settings.instagram)}` : ''].filter(Boolean).join('  ·  ');
const rcptNo = x => x?.receipt_no ? 'R-' + String(x.receipt_no).padStart(5, '0') : '';
const fmtLong = d => fmtD(d, { day: 'numeric', month: 'long', year: 'numeric' });
// Plain-text receipt for pasting into WhatsApp or an email.
function receiptText(x) {
  const p = S.packages[x.package_id]; const st = x.status === 'paid' ? 'Paid' : x.status === 'void' ? 'VOIDED' : 'Pending';
  return [`${S.settings.schoolName || 'Aria Music Academy'} · Payment receipt ${rcptNo(x)}`, `Student: ${sname(x.student_id)}`,
    p ? `Package: ${pkgRef(p)} · ${tname(p.teacherId)} · ${KINDS[p.kind] || p.kind}${p.term ? ' · ' + p.term : ''} (${p.sessions} lessons)` : `For: ${PKIND[x.kind] || x.kind}${x.teacher_id ? ' · ' + tname(x.teacher_id) : ''}`,
    `Amount: ${kd(x.amount)} · ${st}${x.method ? ' · ' + x.method : ''}`, `Date: ${fmtLong(x.paid_on || String(x.created_at || '').slice(0, 10) || kwToday())}`, x.note ? `Note: ${x.note}` : '', contactLine()].filter(Boolean).join('\n');
}
const kd = n => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} KD`;
// Packages a student's payment can belong to (which is what ties it to a teacher), open ones first.
const payPkgs = sid => pkgList().filter(p => p.studentId === sid).sort((a, b) => (a.closed - b.closed) || (b.start || '').localeCompare(a.start || ''));
// A payment's teacher: from its package, or named directly (a trial or single lesson paid before any package).
const payTeacher = x => S.packages[x?.package_id]?.teacherId || x?.teacher_id || null;
const payPkgLabel = p => `${pkgRef(p) ? pkgRef(p) + ' · ' : ''}${tname(p.teacherId)} · ${KINDS[p.kind] || p.kind}${p.term ? ' · ' + p.term : ''}${p.closed ? ' (closed)' : ''}`;
function paymentsSect(list, sid, pid) {
  const pks = pid ? [] : payPkgs(sid); const defPk = pks.find(p => !p.closed);
  const paid = list.filter(x => x.status === 'paid').reduce((a, x) => a + Number(x.amount), 0);
  const pend = list.filter(x => x.status === 'pending').reduce((a, x) => a + Number(x.amount), 0);
  return `<div class="sect" id="paySect"><h3>Payments <span class="muted small" style="font-weight:400">${kd(paid)} paid${pend ? ` · ${kd(pend)} pending` : ''}</span></h3>
   <div class="card" style="padding:4px 12px">${list.length ? list.map(x => `<div class="payrow ${x.status === 'void' ? 'void' : ''}"><div><b>${esc(kd(x.amount))}</b> <span class="pill ${x.status === 'paid' ? 'ok' : x.status === 'void' ? '' : 'warn'}">${x.status === 'paid' ? 'Paid' : x.status === 'void' ? 'Voided' : 'Pending'}</span> <span class="small muted">${esc(PKIND[x.kind] || x.kind)}${x.paid_on ? ' · ' + esc(fmtD(x.paid_on)) : ''}${!pid && x.package_id ? ' · ' + esc(tname(S.packages[x.package_id]?.teacherId)) + ' ' + refTag(S.packages[x.package_id]) : !pid && x.teacher_id ? ' · ' + esc(tname(x.teacher_id)) : ''}</span>${!pid && !x.package_id && x.status !== 'void' && pks.length ? ` <select class="paylink" data-pay-link="${esc(x.id)}" aria-label="Link this payment to a teacher"><option value="">Not linked to a teacher</option>${pks.map(p => `<option value="${esc(p.id)}">${esc(payPkgLabel(p))}</option>`).join('')}</select>` : ''}<div class="small muted">${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''}${x.status === 'void' ? ' · <b>Voided:</b> ' + esc(x.void_reason || '') : ''}</div></div><div style="display:flex;gap:4px"><button class="btn sm" data-pay-receipt="${esc(x.id)}">Receipt</button>${x.status === 'pending' ? `<button class="btn sm" data-pay-mark="${esc(x.id)}">Mark paid</button>` : ''}${x.status !== 'void' ? `<button class="btn sm danger" data-pay-void="${esc(x.id)}">Void</button>` : ''}</div></div>`).join('') : '<div class="empty small">No payments recorded.</div>'}</div>
   <div class="payadd"><input type="number" min="0" step="0.001" id="payAmt" placeholder="Amount (KD)" aria-label="Amount"><input type="text" id="payMethod" list="payMethods" placeholder="Method" aria-label="Method"><datalist id="payMethods">${METHODS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <select id="payKind" aria-label="For">${Object.entries(PKIND).map(([k, v]) => `<option value="${k}" ${k === (pid || defPk ? 'package' : 'book') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${pid ? '' : `<select id="payPkg" aria-label="Teacher / package"><option value="">No teacher (e.g. book)</option>${pks.length ? `<optgroup label="Package">${pks.map(p => `<option value="${esc(p.id)}" ${p === defPk ? 'selected' : ''}>${esc(payPkgLabel(p))}</option>`).join('')}</optgroup>` : ''}${teacherIds().length ? `<optgroup label="Teacher only (trial or single lesson)">${teacherIds().map(t => `<option value="t:${esc(t)}">${esc(tname(t))}</option>`).join('')}</optgroup>` : ''}</select>`}
    <select id="payStatus" aria-label="Status"><option value="paid">Paid</option><option value="pending">Pending</option></select>
    <input type="date" id="payOn" value="${kwToday()}" aria-label="Date"><input type="text" id="payNote" placeholder="Note" aria-label="Note">
    <button class="btn sm primary" id="payAdd" data-sid="${esc(sid)}" data-pid="${esc(pid || '')}">Add payment</button></div></div>`;
}
function wirePayments() {
  const ov = $('#overlay');
  ov.querySelectorAll('[data-pay-void]').forEach(b => b.onclick = () => { const x = S.payments.find(y => y.id === b.dataset.payVoid); reasonBox({ title: 'Void payment', msg: `Void the ${kd(x?.amount)} payment from ${sname(x?.student_id)}? It stays on record, crossed out, and stops counting in totals.`, label: 'Reason (required)', required: true, yes: 'Void payment' }, reason => run(sb.from('payments').update({ status: 'void', void_reason: reason }).eq('id', x.id), 'Payment voided')); });
  ov.querySelectorAll('[data-pay-mark]').forEach(b => b.onclick = () => run(sb.from('payments').update({ status: 'paid', paid_on: S.payments.find(y => y.id === b.dataset.payMark)?.paid_on || kwToday() }).eq('id', b.dataset.payMark), 'Marked as paid').then(() => renderOverlay(true)).catch(() => {}));
  ov.querySelectorAll('[data-pay-link]').forEach(el => el.onchange = () => { if (el.value) run(sb.from('payments').update({ package_id: el.value }).eq('id', el.dataset.payLink), 'Payment linked to ' + tname(S.packages[el.value]?.teacherId)).then(() => renderOverlay(true)).catch(() => {}); });
  const add = $('#payAdd'); if (!add) return;
  // Trial and single lessons usually come before any package: offer the teachers, not the book default.
  const pk = $('#payPkg'); if (pk) $('#payKind').onchange = e => { if ((e.target.value === 'trial' || e.target.value === 'single') && !pk.value) pk.value = pk.querySelector('option[value^="t:"]')?.value || ''; };
  add.onclick = () => {
    if (add.disabled) return;
    const amount = Number($('#payAmt').value); if (!(amount > 0)) return toast('Enter the amount');
    add.disabled = true;
    const pick = $('#payPkg')?.value || ''; const tid = pick.startsWith('t:') ? pick.slice(2) : null;
    const row = { student_id: add.dataset.sid, package_id: add.dataset.pid || (tid ? null : pick) || null, ...(tid ? { teacher_id: tid } : {}), amount, method: $('#payMethod').value.trim(), kind: $('#payKind').value, status: $('#payStatus').value, paid_on: $('#payOn').value || null, note: $('#payNote').value.trim() };
    run(sb.from('payments').insert(row), 'Payment recorded').then(() => renderOverlay(true)).catch(() => {}).finally(() => { add.disabled = false; });
  };
}
const viewToggle = () => `<div class="seg" role="group" aria-label="Show"><button data-payview="in" class="${S.payView === 'in' ? 'on-present' : ''}" aria-pressed="${S.payView === 'in'}">Payments in</button><button data-payview="out" class="${S.payView === 'out' ? 'on-present' : ''}" aria-pressed="${S.payView === 'out'}">Expenses</button></div>`;
const wireViewToggle = () => document.querySelectorAll('[data-payview]').forEach(b => b.onclick = () => { S.payView = b.dataset.payview; render(); });
function renderPayments() {
  if (S.payView === 'out') return renderExpenses();
  const f = S.payFilter; const q = f.q.trim().toLowerCase();
  const all = S.payments;
  const list = all.filter(x => (f.status === 'void' || x.status !== 'void') && (f.method === 'all' || (x.method || '—') === f.method) && (f.status === 'all' || x.status === f.status) && (!q || (sname(x.student_id) + ' ' + x.note + ' ' + x.method + ' ' + pkgRef(S.packages[x.package_id]) + ' ' + rcptNo(x) + ' ' + (payTeacher(x) ? tname(payTeacher(x)) : '')).toLowerCase().includes(q)));
  const paid = all.filter(x => x.status === 'paid'); const pend = all.filter(x => x.status === 'pending');
  const total = a => a.reduce((s, x) => s + Number(x.amount), 0);
  const byMethod = {}; for (const x of paid) byMethod[x.method || '—'] = (byMethod[x.method || '—'] || 0) + Number(x.amount);
  const byTeacher = {}; for (const x of paid) { const t = payTeacher(x); const k = t ? tname(t) : 'Not linked to a teacher'; byTeacher[k] = (byTeacher[k] || 0) + Number(x.amount); }
  const unpaidPk = pkgList().filter(p => !p.closed && p.payment !== 'paid');
  const tiles = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="mrow"><span>${esc(k)}</span><b class="num">${esc(kd(v))}</b></div>`).join('');
  $('#view').innerHTML = `
  <div class="bar"><h2>Payments</h2><span style="margin-left:auto">${viewToggle()}</span></div>
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
   <input type="search" id="yq" placeholder="Search student, note or PKG ref" value="${esc(f.q)}" aria-label="Search payments">
   <select id="ym" aria-label="Method"><option value="all">Any method</option>${[...new Set(all.map(x => x.method || '—'))].sort().map(m => `<option ${f.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
   <select id="ys" aria-label="Status"><option value="all">Paid and pending</option><option value="paid" ${f.status === 'paid' ? 'selected' : ''}>Paid</option><option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Pending</option><option value="void" ${f.status === 'void' ? 'selected' : ''}>Voided</option></select>
   <span class="muted small">${list.length} payments · ${esc(kd(total(list.filter(x => x.status === 'paid'))))}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Amount</th><th>For</th><th>Method</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>${list.map(x => `<tr ${x.package_id ? `data-open-pkg="${esc(x.package_id)}"` : `data-open-stu="${esc(x.student_id)}"`}><td><b>${esc(sname(x.student_id))}</b>${x.package_id ? `<div class="small muted">${esc(tname(S.packages[x.package_id]?.teacherId))} ${refTag(S.packages[x.package_id])}</div>` : x.teacher_id ? `<div class="small muted">${esc(tname(x.teacher_id))}</div>` : ''}</td><td class="num">${esc(kd(x.amount))}</td><td>${esc(PKIND[x.kind] || x.kind)}</td><td class="small">${esc(x.method || '—')}</td><td><span class="pill ${x.status === 'paid' ? 'ok' : x.status === 'void' ? '' : 'warn'}">${x.status === 'paid' ? 'Paid' : x.status === 'void' ? 'Voided' : 'Pending'}</span></td><td class="small muted">${esc(x.note || '')}</td><td><button class="btn sm" data-pay-receipt="${esc(x.id)}" title="Receipt ${esc(rcptNo(x))}">Receipt</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No payments match.</td></tr>'}</tbody></table></div>`;
  $('#yq').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#yq'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#ym').onchange = e => { f.method = e.target.value; render(); };
  $('#ys').onchange = e => { f.status = e.target.value; render(); };
  wireViewToggle();
}

/* ---------- EXPENSES (super admin, on the Payments tab) ---------- */
const EXCAT = { rent: 'Rent', teacher: 'Teacher pay', salary: 'Staff salaries', utilities: 'Utilities & internet', instruments: 'Instruments & repairs', materials: 'Books & materials', marketing: 'Marketing & ads', supplies: 'Office & supplies', other: 'Other' };
const EXMETHODS = ['Company account', 'KNET', 'Cash', 'Bank transfer', 'Paid by Ms. Chaimaa', 'Paid by Ms. Nilufar'];
const monthName = m => fmtD(m + '-01', { month: 'long', year: 'numeric' });
function renderExpenses() {
  const bar = `<div class="bar"><h2>Payments</h2><span style="margin-left:auto">${viewToggle()}</span></div>`;
  if (S.expenses === null) { $('#view').innerHTML = bar + '<div class="card empty">Expenses are not set up in the database yet. Ask the admin to finish the database setup.</div>'; return wireViewToggle(); }
  const f = S.exFilter; const q = f.q.trim().toLowerCase(); const all = S.expenses;
  const inMonth = d => !f.month || String(d || '').slice(0, 7) === f.month;
  const live = all.filter(x => x.status !== 'void' && inMonth(x.spent_on));
  const list = all.filter(x => (f.showVoid || x.status !== 'void') && inMonth(x.spent_on) && (f.cat === 'all' || x.category === f.cat) && (!q || `${x.payee} ${x.note} ${x.method} ${EXCAT[x.category] || ''} ${x.teacher_id ? tname(x.teacher_id) : ''}`.toLowerCase().includes(q)));
  const total = a => a.reduce((t, x) => t + Number(x.amount), 0);
  // Money in for the same period: paid payments by the date they were paid.
  const inSum = total(S.payments.filter(x => x.status === 'paid' && inMonth(x.paid_on || String(x.created_at || '').slice(0, 10))));
  const outSum = total(live); const net = inSum - outSum;
  const byCat = {}; for (const x of live) byCat[EXCAT[x.category] || x.category] = (byCat[EXCAT[x.category] || x.category] || 0) + Number(x.amount);
  const byMethod = {}; for (const x of live) byMethod[x.method || '—'] = (byMethod[x.method || '—'] || 0) + Number(x.amount);
  const tiles = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="mrow"><span>${esc(k)}</span><b class="num">${esc(kd(v))}</b></div>`).join('');
  const months = [...new Set([kwToday().slice(0, 7), ...all.map(x => String(x.spent_on || '').slice(0, 7)).filter(Boolean)])].sort().reverse();
  const period = f.month ? monthName(f.month) : 'all time';
  $('#view').innerHTML = `${bar}
  <div class="paygrid">
   <div class="stat"><b style="color:var(--bad)">${esc(kd(outSum))}</b><span>spent · ${esc(period)} · ${live.length} expenses</span></div>
   <div class="stat"><b style="color:var(--ok)">${esc(kd(inSum))}</b><span>collected · ${esc(period)}</span></div>
   <div class="stat"><b style="color:${net < 0 ? 'var(--bad)' : 'inherit'}">${net < 0 ? '−' : ''}${esc(kd(Math.abs(net)))}</b><span>net (collected minus spent)</span></div>
  </div>
  <div class="card" style="padding:12px 14px;margin-bottom:12px"><div class="eyebrow" style="margin-bottom:8px">Add expense</div>
   <div class="payadd"><input type="number" min="0" step="0.001" id="exAmt" placeholder="Amount (KD)" aria-label="Amount">
    <select id="exCat" aria-label="Category">${Object.entries(EXCAT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    <select id="exT" aria-label="Teacher (for teacher pay)"><option value="">No teacher</option>${teacherIds().map(t => `<option value="${esc(t)}">${esc(tname(t))}</option>`).join('')}</select>
    <input type="text" id="exPayee" placeholder="Paid to (e.g. landlord)" aria-label="Paid to">
    <input type="text" id="exMethod" list="exMethods" placeholder="Method" aria-label="Method"><datalist id="exMethods">${EXMETHODS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <input type="date" id="exOn" value="${kwToday()}" aria-label="Date"><input type="text" id="exNote" placeholder="Note" aria-label="Note">
    <button class="btn sm primary" id="exAdd">Add expense</button></div></div>
  <div class="paycols">
   <div class="card" style="padding:12px 14px"><div class="eyebrow">By category</div>${tiles(byCat) || '<p class="small muted">No expenses yet.</p>'}</div>
   <div class="card" style="padding:12px 14px"><div class="eyebrow">By method</div>${tiles(byMethod) || '<p class="small muted">No expenses yet.</p>'}</div>
  </div>
  <div class="filters" style="margin:16px 0 12px">
   <select id="exM" aria-label="Month"><option value="">All months</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${esc(monthName(m))}</option>`).join('')}</select>
   <select id="exC" aria-label="Category"><option value="all">Any category</option>${Object.entries(EXCAT).map(([k, v]) => `<option value="${k}" ${f.cat === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
   <input type="search" id="exQ" placeholder="Search paid to, note or method" value="${esc(f.q)}" aria-label="Search expenses">
   <label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="exV" ${f.showVoid ? 'checked' : ''}> Show voided</label>
   <span class="muted small">${list.length} expenses · ${esc(kd(total(list.filter(x => x.status !== 'void'))))}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Category</th><th>Paid to</th><th>Method</th><th>Note</th><th></th></tr></thead><tbody>${list.map(x => `<tr class="${x.status === 'void' ? 'voidrow' : ''}"><td class="small">${esc(fmtD(x.spent_on, { day: 'numeric', month: 'short', year: 'numeric' }))}</td><td class="num"><b>${esc(kd(x.amount))}</b>${x.status === 'void' ? ' <span class="pill">Voided</span>' : ''}</td><td>${esc(EXCAT[x.category] || x.category)}</td><td>${esc([x.teacher_id ? tname(x.teacher_id) : '', x.payee].filter(Boolean).join(' · ') || '—')}</td><td class="small">${esc(x.method || '—')}</td><td class="small muted">${esc(x.note || '')}${x.status === 'void' ? `<div><b>Voided:</b> ${esc(x.void_reason || '')}</div>` : ''}</td><td>${x.status !== 'void' ? `<button class="btn sm danger" data-ex-void="${esc(x.id)}">Void</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No expenses match.</td></tr>'}</tbody></table></div>`;
  wireViewToggle();
  $('#exM').onchange = e => { f.month = e.target.value; render(); };
  $('#exC').onchange = e => { f.cat = e.target.value; render(); };
  $('#exV').onchange = e => { f.showVoid = e.target.checked; render(); };
  $('#exQ').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#exQ'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#exCat').onchange = e => { if (e.target.value !== 'teacher') $('#exT').value = ''; };
  $('#exT').onchange = e => { if (e.target.value) $('#exCat').value = 'teacher'; };
  document.querySelectorAll('[data-ex-void]').forEach(b => b.onclick = () => { const x = S.expenses.find(y => y.id === b.dataset.exVoid); reasonBox({ title: 'Void expense', msg: `Void the ${kd(x?.amount)} ${EXCAT[x?.category] || ''} expense from ${fmtD(x?.spent_on)}? It stays on record, crossed out, and stops counting in totals.`, label: 'Reason (required)', required: true, yes: 'Void expense' }, reason => run(sb.from('expenses').update({ status: 'void', void_reason: reason }).eq('id', x.id), 'Expense voided')); });
  const add = $('#exAdd');
  add.onclick = () => {
    if (add.disabled) return;
    const amount = Number($('#exAmt').value); if (!(amount > 0)) { toast('Enter the amount'); return $('#exAmt').focus(); }
    const spent_on = $('#exOn').value; if (!spent_on) return toast('Pick a date');
    add.disabled = true;
    const row = { amount, category: $('#exCat').value, teacher_id: $('#exT').value || null, payee: $('#exPayee').value.trim(), method: $('#exMethod').value.trim(), spent_on, note: $('#exNote').value.trim() };
    run(sb.from('expenses').insert(row), 'Expense recorded').catch(() => { add.disabled = false; });
  };
}

/* ---------- HISTORY (super admin) ---------- */
const AREAS = { all: 'Everything', lessons: 'Attendance', packages: 'Packages', payments: 'Payments', expenses: 'Expenses', students: 'Students', slots: 'Timetable', teachers: 'Teachers', profiles: 'People & access', settings: 'Settings', session: 'Sign-ins & exports' };
const FIELD = {
  lesson_date: 'Date', status: 'Status', note: 'Note', package_id: 'Package', sessions: 'Lessons in package', per_week: 'Lessons per week', start_date: 'Start date',
  term: 'Term', payment: 'Payment', paid_note: 'Payment note', price: 'Price (KWD)', notes: 'Notes', closed: 'Closed', kind: 'Type', subject: 'Subject',
  teacher_id: 'Teacher', student_id: 'Student', name: 'Name', guardian: 'Parent / Guardian', phone: 'Phone', reg_form: 'Registration form', archived: 'Archived',
  day: 'Day', start_time: 'Start', dur: 'Length (min)', label: 'Label', subjects: 'Subjects', color: 'Colour', sort_order: 'Order', school_name: 'Studio name',
  low_threshold: 'Warning level', instagram: 'Instagram', void_reason: 'Void reason', renewed_from: 'Renewed from', ref: 'Reference', role: 'Access', email: 'Email', end_date: 'End date', amount: 'Amount (KWD)', method: 'Method', paid_on: 'Paid on', category: 'Category', payee: 'Paid to', spent_on: 'Date',
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
    case 'expenses': {
      const amt = `${Number(d.amount).toFixed(3).replace(/\.?0+$/, '')} KD`; const what = `${esc(EXCAT[d.category] || d.category)}${d.payee ? ` (${esc(d.payee)})` : d.teacher_id ? ` (${esc(tname(d.teacher_id))})` : ''}`;
      if (A === 'INSERT') return `Recorded an expense of <b>${esc(amt)}</b>: ${what}`;
      if (r.changed.includes('status') && d.status === 'void') return `<b>Voided</b> the ${esc(amt)} expense: ${what}${d.void_reason ? ` — ${esc(d.void_reason)}` : ''}`;
      return `Changed the ${esc(amt)} expense: ${what}`;
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
function diffHtml(r) { return diffBody(r) + (r.reason ? `<div class="small"><span class="pill warn">Reason</span> ${esc(r.reason)}</div>` : ''); }
function diffBody(r) {
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

/* ---------- attendance report for parents (PDF) ---------- */
// Plain words for parents: what happened, and whether it used a lesson from the package.
const PARENT_ST = {
  present: ['Attended', 'ok', 'Uses 1 lesson'], makeup: ['Makeup lesson', 'blue', 'Uses 1 lesson'],
  absent: ['Absent', 'warn', 'Not charged · makeup owed'], cancelled: ['Cancelled by teacher', 'vio', 'Not charged · makeup owed'],
  noshow: ['Missed without notice', 'bad', 'Uses 1 lesson'],
};
function reportPkgHtml(p) {
  const today = kwToday(); const st = stats(p); const log = (p.log || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  const done = log.filter(e => e.d <= today), ahead = log.filter(e => e.d > today);
  const usedSoFar = done.filter(e => ST[e.s]?.counts).length, booked = ahead.filter(e => ST[e.s]?.counts).length;
  const slots = slotsOf(p.teacherId).filter(x => x.studentId === p.studentId).sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
  const sched = slots.map(x => `${DAYS[x.day]} ${fmtTs(x.start)}–${fmtT(toMin(x.start) + x.dur)}`).join(' · ');
  const timeOf = e => lessonTime(p, e);
  let n = 0;
  const rows = log.map(e => { const ps = PARENT_ST[e.s] || [e.s, '', '']; const counts = ST[e.s]?.counts; if (counts) n++; const fut = e.d > today;
    return `<tr class="${fut ? 'fut' : ''}"><td class="rn">${counts ? n : ''}</td><td>${esc(fmtD(e.d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</td><td class="rt">${esc(timeOf(e))}</td><td><span class="rb ${ps[1]}">${esc(ps[0])}</span>${fut ? ' <span class="rup">upcoming</span>' : ''}</td><td class="rc">${esc(ps[2])}</td></tr>`; }).join('');
  const pct = st.total ? Math.min(100, Math.round(st.used / st.total * 100)) : 0;
  const tile = (v, l, cls = '') => `<div class="rtile ${cls}"><b>${v}</b><span>${l}</span></div>`;
  return `<section class="rpkg">
    <div class="rpkg-h"><div><div class="rteacher">${esc(tname(p.teacherId))}${p.subject ? ` <span>· ${esc(p.subject)}</span>` : ''}</div>
      <div class="rmeta">${esc(KINDS[p.kind] || p.kind)} package${p.term ? ' · ' + esc(p.term) : ''}${p.start || p.end ? ` · ${p.start ? esc(fmtLong(p.start)) : ''} → ${p.end ? esc(fmtLong(p.end)) : 'no end date'}` : ''}</div>
      ${sched ? `<div class="rmeta">Weekly lessons: ${esc(sched)}</div>` : ''}</div><div class="rref">${esc(pkgRef(p))}${p.closed ? '<div class="rclosed">Closed</div>' : ''}</div></div>
    <div class="rtiles">${tile(st.total, 'lessons in package')}${tile(usedSoFar, 'used so far')}${booked ? tile(booked, 'booked ahead') : ''}${tile(Math.max(0, st.left), 'remaining', st.left <= 0 ? 'bad' : '')}${tile(st.owed, st.owed === 1 ? 'makeup owed' : 'makeups owed', st.owed ? 'vio' : '')}</div>
    <div class="rbar"><i style="width:${pct}%"></i></div><div class="rbar-l">${st.used} of ${st.total} lessons used${st.used > st.total ? ` · <b style="color:#a3332c">${st.used - st.total} over the package</b>` : ''}</div>
    ${log.length ? `<table class="rtab"><thead><tr><th>#</th><th>Date</th><th>Time</th><th>What happened</th><th>Package</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="rempty">No lessons recorded yet.</p>'}
  </section>`;
}
function contactHtml() {
  const ph = S.settings.phone, ig = igHandle(S.settings.instagram); if (!ph && !ig) return '';
  return `<div class="rcontact">${ph ? `<span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>${esc(ph)}</span>` : ''}${ig ? `<span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 7.3A4.7 4.7 0 1 0 16.7 12 4.7 4.7 0 0 0 12 7.3Zm0 7.8a3.1 3.1 0 1 1 3.1-3.1 3.1 3.1 0 0 1-3.1 3.1Zm6-8a1.1 1.1 0 1 1-1.1-1.1A1.1 1.1 0 0 1 18 7.1ZM21.1 8.2a5.4 5.4 0 0 0-1.5-3.8 5.4 5.4 0 0 0-3.8-1.5C14.3 2.8 9.7 2.8 8.2 2.9a5.4 5.4 0 0 0-3.8 1.5 5.4 5.4 0 0 0-1.5 3.8c-.1 1.5-.1 6.1 0 7.6a5.4 5.4 0 0 0 1.5 3.8 5.4 5.4 0 0 0 3.8 1.5c1.5.1 6.1.1 7.6 0a5.4 5.4 0 0 0 3.8-1.5 5.4 5.4 0 0 0 1.5-3.8c.1-1.5.1-6.1 0-7.6Zm-2 9.2a3.1 3.1 0 0 1-1.8 1.8c-1.2.5-4.1.4-5.3.4s-4.1.1-5.3-.4a3.1 3.1 0 0 1-1.8-1.8c-.5-1.2-.4-4.1-.4-5.4s-.1-4.1.4-5.3a3.1 3.1 0 0 1 1.8-1.8c1.2-.5 4.1-.4 5.3-.4s4.1-.1 5.3.4a3.1 3.1 0 0 1 1.8 1.8c.5 1.2.4 4.1.4 5.3s.1 4.2-.4 5.4Z"/></svg>@${esc(ig)}</span>` : ''}</div>`;
}
function reportHtml(sid, pkgIds) {
  const stu = S.students[sid]; const school = S.settings.schoolName || 'Aria Music Academy';
  const pks = pkgIds.map(id => ({ id, ...S.packages[id] })).filter(p => p.studentId);
  return `<div class="areport" id="areport">
    <header class="rhd"><img src="/brand/aria-gold@2x.png" alt="${esc(school)}"><div><div class="rtitle">Attendance report</div><div class="rsub">Issued ${esc(fmtLong(kwToday()))}</div></div></header>
    <div class="rstu"><div><div class="rlabel">Student</div><div class="rname">${esc(sname(sid))}</div></div>${stu?.guardian ? `<div><div class="rlabel">Parent / Guardian</div><div class="rval">${esc(stu.guardian)}</div></div>` : ''}<div><div class="rlabel">Report date</div><div class="rval">${esc(fmtLong(kwToday()))}</div></div></div>
    ${pks.map(reportPkgHtml).join('') || '<p class="rempty">No packages to show.</p>'}
    <div class="rkey"><div class="rlabel">What each mark means</div><div class="rkeys">${Object.values(PARENT_ST).map(([l, c, d]) => `<div><span class="rb ${c}">${esc(l)}</span> ${esc(d)}</div>`).join('')}</div>
      <p>A makeup is owed when a lesson is missed with notice or cancelled by the teacher. Makeup lessons replace those lessons and then count towards the package.</p>
      <div class="rthanks">Thank you for learning with ${esc(school)}</div>${contactHtml()}</div></div>`;
}
async function downloadReport(sid, name) {
  const el = $('#areport'); if (!el) return; const btn = $('#rDl'); if (btn) { btn.disabled = true; btn.textContent = 'Making PDF…'; }
  try {
    await document.fonts?.ready;
    const html2pdf = (await import('html2pdf.js')).default;
    let canvas, size;
    await html2pdf().set({ margin: [0, 0, 12, 0], filename: name, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fffdf8', windowWidth: 794 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.rtiles', '.rpkg-h', '.rkey'] } })
      .from(el).toPdf().get('canvas').then(c => { canvas = c; }).get('pageSize').then(ps => { size = ps; }).get('pdf').then(pdf => {
        // html2pdf can leave an empty last page; keep only the pages the content actually fills.
        const pagePx = Math.floor(canvas.width * size.inner.height / size.inner.width); const need = Math.max(1, Math.ceil((canvas.height - 36) / pagePx)); // the last 18px is the report's bottom margin
        while (pdf.internal.getNumberOfPages() > need) pdf.deletePage(pdf.internal.getNumberOfPages());
        const n = pdf.internal.getNumberOfPages(); for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120, 100, 110); pdf.setDrawColor(201, 162, 63); pdf.setLineWidth(0.4); pdf.line(12, 287, 198, 287); pdf.text([S.settings.schoolName || 'Aria Music Academy', contactLine()].filter(Boolean).join('  ·  '), 12, 292); pdf.text(`Page ${i} of ${n}`, 198, 292, { align: 'right' }); } }).save();
    sb.rpc('log_event', { p_action: 'EXPORT', p_detail: { file: name, student_id: sid } }).then(() => {}, () => {});
  } catch (e) { console.error(e); toast('Could not make the PDF. Try Print → Save as PDF instead.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Download PDF'; } }
}
function drawPackage(id) {
  const p = S.packages[id]; if (!p) { closeOverlay(); return; }
  const s = stats(p); const A = isAdmin(); const dis = A ? '' : 'disabled';
  const opts = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(Array.isArray(v) ? v[0] : (v.label || v))}</option>`).join('');
  const log = (p.log || []).map(e => isPast(e.d) ? `<div class="logrow past"><span class="small">🔒 ${esc(fmtD(e.d))}</span><span class="chip ${esc(e.s)}" style="justify-self:start">${esc(ST[e.s]?.label || e.s)}</span><span class="ltime small">${lessonTime(p, e) ? esc(lessonTime(p, e)) : '<span class="muted">no time set</span>'}</span><span class="lnote small muted">${esc(e.n || '')}</span>${A ? `<button class="btn ghost sm" data-correct="${esc(e.id)}" title="Correct this past mark (reason required)" aria-label="Correct">✎</button>` : '<span></span>'}</div>` : `<div class="logrow"><input type="date" value="${esc(e.d)}" data-lg="${esc(e.id)}|lesson_date" aria-label="Date"><select data-lg="${esc(e.id)}|status" aria-label="Status">${opts(ST, e.s)}</select><input class="ltime" type="time" step="300" value="${esc(e.t || '')}" data-lg="${esc(e.id)}|start_time" aria-label="Time (for a makeup or extra lesson)" title="Time, for a makeup or extra lesson"><input class="lnote" type="text" value="${esc(e.n || '')}" placeholder="Note" data-lg="${esc(e.id)}|note" aria-label="Note"><button class="btn ghost sm" data-lgdel="${esc(e.id)}" aria-label="Remove">✕</button></div>`).join('');
  shell(sname(p.studentId), `${refTag(p)} ${esc(tname(p.teacherId))} · ${esc(KINDS[p.kind] || '')} package${p.term ? ' · ' + esc(p.term) : ''}`, `
   <div class="namecell" style="gap:10px">${avatar('student', p.studentId, 44)}${avatar('teacher', p.teacherId, 32)}</div>
   ${p.closed ? '<div class="infobox">This package is closed. It is kept for history.</div>' : s.used > s.total ? `<div class="badbox">${s.used - s.total} lesson(s) used beyond the package. Renew and move the extra lessons, or adjust the size.</div>` : s.state === 'finished' ? '<div class="badbox">All lessons used. Renew to keep marking attendance.</div>' : ''}
   ${!p.closed ? carriedOwed(p.studentId, p.teacherId).map(o => `<div class="infobox">${stats(o).owed} makeup${stats(o).owed === 1 ? '' : 's'} still owed from the previous package <a data-open-pkg="${esc(o.id)}">${esc(pkgRef(o) || 'package')}</a>. Use “Log makeup or extra” and it goes on that package, without using a lesson from this one.</div>`).join('') : s.owed ? `<div class="infobox">${s.owed} makeup${s.owed === 1 ? '' : 's'} still owed on this package. Use “Log makeup or extra” to book ${s.owed === 1 ? 'it' : 'them'}; ${s.owed === 1 ? 'it goes' : 'they go'} on this package.</div>` : ''}
   ${s.ended ? `<div class="warnbox">This package's end date (${esc(fmtD(p.end))}) has passed${s.left > 0 ? ` with ${s.left} lessons not used` : ''}. Renew or close it.</div>` : ''}
   <div class="row-end" style="justify-content:flex-start;margin-bottom:-4px"><button class="btn sm" data-att-report="${esc(p.studentId)}|${esc(id)}">📄 Attendance report for parents</button></div>
   <div class="stats"><div class="stat"><b>${s.used}</b><span>used of ${s.total}</span></div><div class="stat"><b style="color:${s.left <= 0 ? 'var(--bad)' : s.state === 'low' ? 'var(--warn)' : 'inherit'}">${s.left}</b><span>left</span></div><div class="stat"><b>${s.owed}</b><span>makeups owed</span></div><div class="stat"><b>${s.c.absent + s.c.cancelled}</b><span>missed</span></div></div>
   <div class="sect"><h3>Lessons <span class="muted small" style="font-weight:400">${(p.log || []).length} logged${s.last ? ' · last ' + esc(fmtD(s.last)) : ''}</span></h3>
    <div class="card" style="padding:4px 12px"><div class="loglist">${log || '<div class="empty small">No lessons logged yet.</div>'}</div></div>
    <div class="logrow" style="border:0"><input type="date" id="nlD" value="${kwToday()}" aria-label="New lesson date"><select id="nlS" aria-label="New lesson status">${opts(ST, 'present')}</select><input class="ltime" type="time" step="300" id="nlT" aria-label="New lesson time (optional)" title="Time, for a makeup or extra lesson"><input class="lnote" type="text" id="nlN" placeholder="Note (optional)" aria-label="New lesson note"><button class="btn sm primary" id="nlAdd" aria-label="Add lesson">+</button></div>
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
   ${A ? `<div class="row-end">${p.closed ? '<button class="btn sm" id="pReopen">Reopen</button>' : `${p.kind === 'trial' && !(p.log || []).length ? `<button class="btn sm primary" data-book-trial="${esc(id)}">Book trial time</button>` : ''}<button class="btn sm" id="pClose">Close</button><button class="btn sm" id="pRenew">Renew</button>`}<button class="btn primary sm" id="pSave">Save package</button></div>` : '<p class="small muted" style="margin:0">Only a super admin can change package details.</p>'}</div>
   <div class="sect"><h3>Weekly times with ${esc(tname(p.teacherId))}</h3><div class="small">${slotsOf(p.teacherId).filter(x => x.studentId === p.studentId).map(x => `${DAYS[x.day]} ${fmtT(x.start)} (${x.dur} min)${x.status === 'tentative' ? ' · not confirmed' : ''}`).join('<br>') || '<span class="muted">Not on the timetable.</span>'}</div>
   <div><button class="btn sm" data-open-stu="${esc(p.studentId)}">Open student</button></div></div>
   ${A ? paymentsSect(S.payments.filter(x => x.package_id === id), p.studentId, id) : ''}
   ${A ? timelineSect('package', id) : ''}`);
  wirePayments();
  const ov = $('#overlay');
  ov.querySelectorAll('[data-correct]').forEach(b => b.onclick = () => openModal('correct', { pid: id, lessonId: b.dataset.correct }));
  ov.querySelectorAll('[data-lg]').forEach(el => el.onchange = () => { const [lid, col] = el.dataset.lg.split('|'); if (col === 'lesson_date' && !el.value) return;
    if (col === 'lesson_date' && isPast(el.value)) { if (!isAdmin()) { toast('Past attendance is locked. Ask a super admin to correct it.'); renderOverlay(true); return; } return openModal('correct', { pid: id, lessonId: lid, date: el.value }); }
    const ex = (p.log || []).find(x => x.id === lid);
    const patch = col === 'start_time' ? { start_time: el.value || null, dur: el.value ? ex?.du || defDur(p.studentId, p.teacherId) : null } : { [col]: el.value };
    const nd = col === 'lesson_date' ? el.value : ex?.d, nt = col === 'start_time' ? el.value : ex?.t;
    const cl = nd && nt ? clashesFor(p.teacherId, p.studentId, nd, nt, ex?.du || defDur(p.studentId, p.teacherId), lid) : [];
    run(sb.from('lessons').update(patch).eq('id', lid)).then(() => { renderOverlay(true); if (cl.length) toast(`Saved, but it clashes: ${clashText(cl, p.teacherId)}`, 7000); }).catch(() => {}); });
  ov.querySelectorAll('[data-lgdel]').forEach(b => b.onclick = () => { const e = (p.log || []).find(x => x.id === b.dataset.lgdel); confirmBox(`Remove the "${ST[e?.s]?.label || ''}" mark on ${fmtD(e?.d)}? This is recorded in History.`, () => run(sb.from('lessons').delete().eq('id', b.dataset.lgdel), 'Mark removed'), 'Remove mark'); });
  $('#nlAdd').onclick = () => { const d = $('#nlD').value; if (!d) return toast('Pick a date'); if (entryFor(p, d)) return toast('A lesson is already logged on that date'); const nt = $('#nlT').value; const cl = nt ? clashesFor(p.teacherId, p.studentId, d, nt, defDur(p.studentId, p.teacherId)) : [];
    const nst = $('#nlS').value; const home = makesUp(p.studentId, p.teacherId, d, nst) && !s.owed ? owingPkg(p.studentId, p.teacherId) : null; if (home && entryFor(home, d)) return toast('A lesson is already logged on that date');
    if (home && home.id !== id) toast(`This makes up the lesson owed on ${pkgRef(home) || 'the previous package'}, so it goes there.`, 5000);
    run(sb.from('lessons').insert({ package_id: home?.id || id, lesson_date: d, status: nst, note: $('#nlN').value.trim(), start_time: nt || null, dur: nt ? defDur(p.studentId, p.teacherId) : null }), cl.length ? '' : 'Lesson added').then(() => { renderOverlay(true); if (cl.length) toast(`Added, but it clashes: ${clashText(cl, p.teacherId)}`, 7000); }).catch(() => {}); };
  if (!A) return;
  $('#pSave').onclick = () => savePkg(id, { teacherId: $('#pT').value, kind: $('#pK').value, sessions: Math.max(1, +$('#pN').value || 1), perWeek: Math.max(1, Math.min(7, +$('#pW').value || 1)), start: $('#pS').value, end: $('#pE').value, term: $('#pTerm').value.trim(), subject: $('#pSub').value.trim(), payment: $('#pP').value, price: $('#pPr').value === '' ? null : +$('#pPr').value, paidNote: $('#pPn').value.trim(), notes: $('#pNo').value }, 'Package saved').then(() => renderOverlay(true)).catch(() => {});
  const stamp = what => `${what} ${fmtD(kwToday(), { day: 'numeric', month: 'short', year: 'numeric' })} by ${S.session.user.email}`;
  if ($('#pClose')) $('#pClose').onclick = () => reasonBox({ title: 'Close package', msg: 'Closing keeps the package and its lessons for history. It stops showing as open.', label: 'Reason (optional)', yes: 'Close package' }, reason => savePkg(id, { closed: true, notes: [p.notes, stamp('Closed') + (reason ? ': ' + reason : '')].filter(Boolean).join('\n') }, 'Package closed'));
  if ($('#pReopen')) $('#pReopen').onclick = () => reasonBox({ title: 'Reopen package', msg: 'Reopen this package so lessons can be marked on it again?', label: 'Reason (optional)', yes: 'Reopen' }, reason => savePkg(id, { closed: false, notes: [p.notes, stamp('Reopened') + (reason ? ': ' + reason : '')].filter(Boolean).join('\n') }, 'Package reopened'));
  if ($('#pRenew')) $('#pRenew').onclick = () => openModal('newpkg', { studentId: p.studentId, teacherId: p.teacherId, renewOf: id });
}
// At-a-glance summary of what a student takes: per teacher, the package type, lessons a week, length, days and times.
function studentSummary(id) {
  const today = kwToday(); const sl = studentSlots(id);
  const open = pkgList().filter(p => p.studentId === id && !p.closed).sort((a, b) => tname(a.teacherId).localeCompare(tname(b.teacherId)));
  const tids = [...new Set(open.map(p => p.teacherId).concat(sl.map(x => x.teacherId)))];
  if (!tids.length) return '<p class="muted small">No open package and not on the timetable.</p>';
  const hrs = m => m % 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`;
  return tids.map(tid => {
    const ps = open.filter(p => p.teacherId === tid); const ts = sl.filter(x => x.teacherId === tid);
    const durs = [...new Set(ts.map(x => x.dur))]; const perWeek = ps[0]?.perWeek || ts.length;
    const head = [ps[0]?.subject, `${perWeek}× a week`, durs.length ? durs.map(hrs).join(' / ') + ' each' : ''].filter(Boolean).join(' · ');
    const times = ts.length ? ts.map(x => `<li>${DAYS[x.day]} ${fmtTs(x.start)}–${fmtT(toMin(x.start) + x.dur)}${x.status === 'tentative' ? ' <span class="pill warn">not confirmed</span>' : ''}</li>`).join('') : '<li class="muted">No weekly time on the timetable yet</li>';
    const warn = ps.length && ts.length && ts.length !== perWeek ? `<div class="small" style="color:var(--warn)">The package says ${perWeek}× a week but the timetable has ${ts.length} weekly time${ts.length === 1 ? '' : 's'}.</div>` : '';
    const pk = ps.map(p => { const st = stats(p); return `<div class="small" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;cursor:pointer" data-open-pkg="${esc(p.id)}">${refTag(p)}<b>${esc(KINDS[p.kind] || p.kind)} package</b>${p.term ? `<span class="muted">${esc(p.term)}</span>` : ''}<span>${st.total} lessons · ${st.used} used · <b style="color:${st.left <= 0 ? 'var(--bad)' : st.state === 'low' ? 'var(--warn)' : 'inherit'}">${st.left} left</b></span>${st.owed ? `<span class="pill vio">${st.owed} makeup owed</span>` : ''}<span class="pill ${PAY[p.payment]?.[1] || ''}">${esc(PAY[p.payment]?.[0] || p.payment)}</span>${p.start || p.end ? `<span class="muted">${p.start ? esc(fmtD(p.start, { day: 'numeric', month: 'short', year: 'numeric' })) : ''} → ${p.end ? esc(fmtD(p.end, { day: 'numeric', month: 'short', year: 'numeric' })) : 'no end date'}</span>` : ''}</div>`; }).join('') || '<div class="small" style="color:var(--bad)">No open package with this teacher</div>';
    const carried = carriedOwed(id, tid).map(o => `<div class="small" style="cursor:pointer;margin-top:4px" data-open-pkg="${esc(o.id)}"><span class="pill vio">${stats(o).owed} makeup owed</span> from the previous package ${refTag(o)}</div>`).join('');
    const upcoming = pairPkgs(id, tid).flatMap(p => (p.log || []).filter(e => e.d >= today && e.s === 'makeup').map(e => `<li>${esc(fmtD(e.d))}${e.t ? ` ${fmtTs(e.t)}–${fmtT(toMin(e.t) + (e.du || defDur(id, tid)))}` : ' (no time set)'}</li>`)).join('');
    return `<div class="card" style="padding:12px 14px;border-left:4px solid ${esc(tcolor(tid))}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${avatar('teacher', tid, 24)}<b>${esc(tname(tid))}</b><span class="muted small">${esc(head)}</span></div>
      <ul class="small" style="margin:6px 0;padding-left:18px">${times}</ul>${warn}${pk}${carried}${upcoming ? `<div class="small" style="margin-top:6px"><b>Upcoming makeups</b><ul style="margin:2px 0 0;padding-left:18px">${upcoming}</ul></div>` : ''}</div>`;
  }).join('');
}
function drawStudent(id) {
  const s = S.students[id]; if (!s) { closeOverlay(); return; }
  const A = isAdmin(); const dis = A ? '' : 'disabled';
  const pk = pkgList().filter(p => p.studentId === id).sort((a, b) => (a.closed - b.closed) || (b.start || '').localeCompare(a.start || ''));
  shell(s.name, s.archived ? 'Archived' : '', `
   ${photoBlock('student', id)}
   <div class="sect"><h3>Lessons${pkgList().some(p => p.studentId === id) ? `<button class="btn sm" style="margin-left:auto" data-att-report="${esc(id)}|">📄 Attendance report</button>` : ''}</h3>${studentSummary(id)}</div>
   <div class="grid2">
    <label class="f">Name<input type="text" id="sN" value="${esc(s.name)}" ${dis}></label>
    <label class="f">Parent / Guardian<input type="text" id="sG" value="${esc(s.guardian || '')}" ${dis}></label>
    <label class="f">Phone<input type="tel" id="sP" value="${esc(s.phone || '')}" ${dis}>${intlPhone(s.phone) ? `<span style="margin-top:4px">${phoneLinks(s.phone, true)}</span>` : ''}</label>
    <label class="f">Registration form<select id="sF" ${dis}>${Object.entries(FORM).map(([k, v]) => `<option value="${k}" ${s.regForm === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
   </div><label class="f">Notes<textarea id="sNo" ${dis}>${esc(s.notes || '')}</textarea></label>
   ${A ? `<div class="row-end">${s.archived ? '<button class="btn sm" id="sArch">Restore</button>' : ''}<button class="btn sm primary" id="sSave">Save student</button></div>` : ''}
   <div class="sect"><h3>All packages</h3>${pk.map(p => { const st = stats(p); return `<div class="card" style="padding:10px 12px;cursor:pointer" data-open-pkg="${esc(p.id)}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="dot" style="background:${esc(tcolor(p.teacherId))}"></span><b>${esc(tname(p.teacherId))}</b>${refTag(p)}<span class="muted small">${esc(KINDS[p.kind] || '')} · ${esc(p.term || '')}</span><span style="margin-left:auto" class="pill ${p.closed ? '' : st.state === 'finished' ? 'bad' : st.state === 'low' ? 'warn' : 'ok'}">${p.closed ? 'Closed' : st.left + ' left'}</span></div>${meter(st)}${chips(p)}</div>`; }).join('') || '<p class="muted small">No packages yet.</p>'}
    ${A ? '<div><button class="btn sm" id="sNewPkg">New package</button></div>' : ''}</div>
   ${A ? paymentsSect(S.payments.filter(x => x.student_id === id), id, null) : ''}
   ${A ? timelineSect('student', id) : ''}`);
  if (!A) return;
  wirePayments();
  $('#sSave').onclick = () => { const patch = { name: $('#sN').value.trim(), guardian: $('#sG').value.trim(), phone: $('#sP').value.trim(), regForm: $('#sF').value, notes: $('#sNo').value }; if (!patch.name) return toast('A student needs a name'); run(sb.from('students').update(toRow(patch, stuCols)).eq('id', id), 'Student saved').then(() => renderOverlay(true)).catch(() => {}); };
  if (s.archived) $('#sArch').onclick = () => run(sb.from('students').update({ archived: false }).eq('id', id), 'Restored').catch(() => {});
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
  } else if (kind === 'report') {
    const all = payPkgs(ctx.sid); if (!ctx.pids.length && all.length) ctx.pids = [all[0].id];
    const fname = `Attendance - ${sname(ctx.sid)} - ${kwToday()}.pdf`.replace(/[\\/:*?"<>|]/g, '');
    shell('Attendance report', '', `<p class="small muted" style="margin:0">A report for ${esc(sname(ctx.sid))}'s parents. Download it as a PDF to send on WhatsApp or email.</p>
      ${all.length > 1 ? `<div class="rpick">${all.map(p => `<label><input type="checkbox" data-rp="${esc(p.id)}" ${ctx.pids.includes(p.id) ? 'checked' : ''}> <span class="ref">${esc(pkgRef(p))}</span> ${esc(tname(p.teacherId))} · ${esc(KINDS[p.kind] || p.kind)}${p.term ? ' · ' + esc(p.term) : ''}${p.closed ? ' <span class="muted">(closed)</span>' : ''}</label>`).join('')}</div>` : ''}
      <div class="rprev">${reportHtml(ctx.sid, ctx.pids)}</div>
      <div class="row-end">${cancel.replace('Cancel', 'Close')}<button class="btn" id="rPr">Print</button><button class="btn primary" id="rDl">Download PDF</button></div>`, true);
    $('#overlay .modal').classList.add('wide');
    document.querySelectorAll('[data-rp]').forEach(cb => cb.onchange = () => { ctx.pids = all.filter(p => document.querySelector(`[data-rp="${CSS.escape(p.id)}"]`).checked).map(p => p.id); $('.rprev').innerHTML = reportHtml(ctx.sid, ctx.pids); });
    $('#rDl').onclick = () => ctx.pids.length ? downloadReport(ctx.sid, fname) : toast('Tick at least one package');
    $('#rPr').onclick = () => window.print();
  } else if (kind === 'receipt') {
    const x = S.payments.find(y => y.id === ctx.payId); if (!x) { backFromModal(); return; }
    const p = S.packages[x.package_id]; const stu = S.students[x.student_id];
    const st = x.status === 'paid' ? ['Paid', 'ok'] : x.status === 'void' ? ['Voided', 'bad'] : ['Pending', 'warn'];
    const row = (k, v) => v ? `<div class="rrow"><span>${esc(k)}</span><b>${v}</b></div>` : '';
    shell('Payment receipt', '', `<div class="receipt ${x.status === 'void' ? 'void' : ''}" id="rcpt">
      <div class="rhead"><img src="/brand/aria-gold@2x.png" alt="${esc(S.settings.schoolName || 'Aria Music Academy')}" class="rlogo"><div style="text-align:right"><div class="eyebrow">${x.status === 'paid' ? 'Payment receipt' : x.status === 'void' ? 'Voided receipt' : 'Payment due'}</div><div class="rno">${esc(rcptNo(x))}</div><div class="small muted">${esc(fmtLong(x.paid_on || String(x.created_at || '').slice(0, 10) || kwToday()))}</div></div></div>
      <div class="ramt"><span>${esc(kd(x.amount))}</span><span class="pill ${st[1]}">${st[0]}</span></div>
      ${row('Student', esc(sname(x.student_id)))}${row('Parent / Guardian', esc(stu?.guardian || ''))}
      ${row('For', esc(PKIND[x.kind] || x.kind))}${!p && x.teacher_id ? row('Teacher', esc(tname(x.teacher_id))) : ''}
      ${p ? row('Package ref', `<span class="ref">${esc(pkgRef(p))}</span>`) + row('Teacher', esc(tname(p.teacherId))) + row('Package', esc(`${KINDS[p.kind] || p.kind}${p.subject ? ' · ' + p.subject : ''}${p.term ? ' · ' + p.term : ''}`)) + row('Lessons', esc(`${p.sessions} lessons · ${p.perWeek || 1}× a week`)) + row('Dates', esc(p.start || p.end ? `${p.start ? fmtLong(p.start) : ''} → ${p.end ? fmtLong(p.end) : 'no end date'}` : '')) : ''}
      ${row('Method', esc(x.method || ''))}${row('Note', esc(x.note || ''))}${x.status === 'void' ? row('Voided', esc(x.void_reason || '')) : ''}
      <div class="rfoot small muted">${esc(S.settings.schoolName || 'Aria Music Academy')} · Issued ${esc(fmtLong(kwToday()))}${contactLine() ? `<br>${esc(contactLine())}` : ''}</div></div>
     <div class="row-end">${cancel.replace('Cancel', 'Close')}<button class="btn" id="rCopy">Copy for WhatsApp</button><button class="btn primary" id="rPrint">Print or save PDF</button></div>`, true);
    $('#rPrint').onclick = () => window.print();
    $('#rCopy').onclick = async () => { try { await navigator.clipboard.writeText(receiptText(x)); toast('Receipt copied. Paste it into WhatsApp.'); } catch { toast('Could not copy. Select the receipt text instead.'); } };
  } else if (kind === 'correct') {
    const p = S.packages[ctx.pid]; const e = (p?.log || []).find(x => x.id === ctx.lessonId); if (!e) { backFromModal(); return; }
    const opts2 = Object.entries(ST).map(([k, v]) => `<option value="${k}" ${(ctx.status || e.s) === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    shell('Correct past attendance', '', `<p style="margin:0">${esc(sname(p.studentId))} · ${esc(tname(p.teacherId))} · ${esc(fmtD(e.d, { weekday: 'long', day: 'numeric', month: 'long' }))}<br><span class="small muted">Currently: ${esc(ST[e.s]?.label || e.s)}${e.n ? ' · ' + esc(e.n) : ''}</span></p>
     <div class="grid2"><label class="f">Date<input type="date" id="cD" value="${esc(ctx.date || e.d)}"></label><label class="f">Status<select id="cS">${opts2}</select></label>
     <label class="f">Time${!e.t && lessonTime(p, e) ? ` <span class="muted" style="font-weight:400">(weekly: ${esc(lessonTime(p, e))})</span>` : ''}<input type="time" id="cT" step="300" value="${esc(e.t || '')}"></label><label class="f">Length (min)<input type="number" id="cDu" min="5" max="240" step="5" value="${esc(e.du || defDur(p.studentId, p.teacherId))}"></label></div>
     <p class="small muted" style="margin:0">Leave the time empty for a lesson at the student's usual weekly time.</p>
     <label class="f">Note<input type="text" id="cN" value="${esc(e.n || '')}"></label>
     <label class="f">Reason for the correction (required)<textarea id="cR" style="min-height:70px" placeholder="e.g. Marked the wrong student by mistake"></textarea></label>
     <div class="row-end"><button class="btn danger" id="cDel" style="margin-right:auto">Remove this mark</button>${cancel}<button class="btn primary" id="cOk">Save correction</button></div>`, true);
    const reason = () => { const r = $('#cR').value.trim(); if (!r) { toast('Please give a reason'); $('#cR').focus(); } return r; };
    $('#cOk').onclick = async () => { const r = reason(); if (!r) return; const d = $('#cD').value; if (!d) return toast('Pick a date'); backFromModal();
      const tm = $('#cT').value, du = Math.max(5, Math.min(240, +$('#cDu').value || 45)); const timeChanged = (tm || null) !== (e.t || null) || (tm && du !== (e.du || null));
      try {
        await run(sb.rpc('correct_lesson', { p_id: e.id, p_status: $('#cS').value, p_note: $('#cN').value.trim(), p_date: d, p_reason: r }));
        if (timeChanged) await run(sb.rpc('correct_lesson_time', { p_id: e.id, p_time: tm, p_dur: du, p_reason: r }));
        toast('Attendance corrected');
      } catch (err) { /* toast shown */ }
      renderOverlay(true); };
    $('#cDel').onclick = async () => { const r = reason(); if (!r) return; backFromModal();
      await run(sb.rpc('remove_lesson', { p_id: e.id, p_reason: r }), 'Mark removed').catch(() => {}); renderOverlay(true); };
  } else if (kind === 'reason') {
    shell(ctx.title, '', `<p style="margin:0">${esc(ctx.msg)}</p><label class="f">${esc(ctx.label)}<textarea id="mReason" style="min-height:70px"></textarea></label><div class="row-end">${cancel}<button class="btn primary" id="mYes">${esc(ctx.yes || 'Confirm')}</button></div>`, true);
    $('#mYes').onclick = async () => { const reason = $('#mReason').value.trim(); if (ctx.required && !reason) return toast('Please give a reason'); const f = ctx.onYes; backFromModal(); try { await f(reason); renderOverlay(true); } catch (e) { /* toast shown */ } };
  } else if (kind === 'newstu') {
    shell('Add student', '', `<div class="grid2"><label class="f">Name<input type="text" id="mN"></label><label class="f">Parent / Guardian<input type="text" id="mG"></label><label class="f">Phone<input type="tel" id="mP"></label><label class="f">Registration form<select id="mF">${Object.entries(FORM).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Add student</button></div>`, true);
    $('#mOk').onclick = async () => {
      const name = $('#mN').value.trim(); if (!name) return toast('Enter a name');
      if (studentIds(true).some(id => sname(id).toLowerCase() === name.toLowerCase())) return toast('A student with that name already exists');
      const id = slug(name) + '-' + rid(); const btn = $('#mOk'); if (btn.disabled) return; btn.disabled = true;
      try { await run(sb.from('students').insert({ id, name, guardian: $('#mG').value.trim(), phone: $('#mP').value.trim(), reg_form: $('#mF').value }), 'Student added'); modal = null; openDrawer('student', id); } catch (e) { btn.disabled = false; }
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
     ${old ? `<div class="infobox">The current package (${os.used} of ${os.total} used${os.owed ? `, ${os.owed} makeup owed` : ''}) will be closed and kept in history. Lessons already marked from the new start date on${os.used > os.total ? `, and the ${os.used - os.total} extra lesson(s),` : ''} move to the new package.</div>` : ''}
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
    const sync = () => { const k = $('#mK').value; const w = +$('#mW').value; if (k === 'semester') $('#mNn').value = w >= 2 ? 30 : 15; else if (k === 'monthly') $('#mNn').value = w >= 2 ? 8 : 4; else if (k === 'trial') { $('#mNn').value = 1; $('#mW').value = 1; } };
    // A new trial is booked in the Book trial form, which reuses a trial package the student already has.
    $('#mK').onchange = () => { if (!old && $('#mK').value === 'trial') { modal = { kind: 'trial', ctx: { studentId: $('#mSt').value, teacherId: $('#mT').value, date: kwToday() }, prev: modal.prev }; return renderOverlay(true); } sync(); };
    $('#mW').onchange = sync;
    $('#mOk').onclick = async () => {
      const sid = old ? old.studentId : $('#mSt').value; if (!sid) return toast('Choose a student'); const tid = $('#mT').value; if (!tid) return toast('Add a teacher first');
      const btn = $('#mOk'); if (btn.disabled) return; btn.disabled = true;
      const id = `${tid}--${sid}--${Date.now().toString(36)}`;
      const row = { id, renewed_from: old ? ctx.renewOf : null, student_id: sid, teacher_id: tid, subject: old?.subject || '', kind: $('#mK').value, sessions: Math.max(1, +$('#mNn').value || 1), per_week: Math.max(1, Math.min(7, +$('#mW').value || 1)), start_date: $('#mS').value || kwToday(), end_date: $('#mE').value || null, term: $('#mTerm').value.trim(), payment: $('#mP').value, price: $('#mPr').value === '' ? null : +$('#mPr').value, notes: old && os.owed ? `${os.owed} makeup(s) still owed from the previous package.` : '' };
      try {
        if (old) {
          await run(sb.rpc('renew_package', { p_old: ctx.renewOf, p_new: row, p_move: renewMoves(old, row.start_date) }));
        } else {
          await run(sb.from('packages').insert(row));
        }
        toast(old ? 'Package renewed' : 'Package created'); modal = null; openDrawer('package', id);
      } catch (e) { btn.disabled = false; }
    };
  } else if (kind === 'extra') {
    const only = isAdmin() ? null : myTeacher();
    shell('Log makeup or extra lesson', '', `<div class="grid2"><label class="f">Teacher<select id="mT">${teaOptions(only || ctx.teacherId || S.weekTeacher || teacherIds()[0], only)}</select></label><label class="f">Student<select id="mSt">${stuOptions('')}</select></label>
     <label class="f">Date<input type="date" id="mD" value="${esc(ctx.date || kwToday())}"></label><label class="f">What happened<select id="mSs">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === 'makeup' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
     <label class="f">Time<input type="time" id="mTm" step="300"></label><label class="f">Length (min)<input type="number" id="mDu" min="5" max="240" step="5" value="45"></label></div>
     <label class="f">Note<input type="text" id="mNo" placeholder="e.g. makeup for 14 Sep"></label><div id="mInfo" class="small muted"></div><div id="mClash"></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Log lesson</button></div>`, true);
    const info = () => { const sid = $('#mSt').value, tid = $('#mT').value; if (sid && !$('#mDu').dataset.touched) $('#mDu').value = defDur(sid, tid); const p = sid ? (makesUp(sid, tid, $('#mD').value, $('#mSs').value) ? makeupPkg : pkgForDate)(sid, tid, $('#mD').value) : null; $('#mInfo').innerHTML = !sid ? '' : !p ? '<span style="color:var(--bad)">This student has no package with this teacher.</span>' : p.closed ? `Makes up a lesson owed from the previous package ${esc(pkgRef(p))} (${stats(p).owed} owed). It does not use a lesson from the new package.` : `Goes on the ${esc(KINDS[p.kind] || '')} package ${esc(pkgRef(p))}: ${stats(p).used} of ${stats(p).total} used, ${stats(p).owed} makeup owed.`; };
    const check = () => {
      const sid = $('#mSt').value, tid = $('#mT').value, d = $('#mD').value, tm = $('#mTm').value, du = Math.max(5, Math.min(240, +$('#mDu').value || 45));
      if (!tid || !d) { $('#mClash').innerHTML = ''; return; }
      const cl = tm ? clashesFor(tid, sid, d, tm, du) : [];
      const gaps = freeGaps(tid, d, du);
      $('#mClash').innerHTML = (cl.length ? `<div class="warnbox" role="alert" style="margin-top:8px"><b>⚠ Clash.</b> ${esc(clashText(cl, tid))}. Pick a free time below, or log it anyway if this is intended.</div>` : tm ? `<div class="small" style="color:var(--ok)">✓ ${esc(tname(tid))}${sid ? ` and ${esc(sname(sid))} are` : ' is'} free at this time.</div>` : '')
        + `<div class="small muted" style="margin-top:6px">Free for ${esc(tname(tid))} on ${esc(fmtD(d))}: ${gaps.length ? gaps.map(([a, b]) => `<button type="button" class="btn sm ghost" data-gap="${toT(a)}" title="Use ${esc(fmtT(a))}">${fmtTs(a)}–${fmtT(b)}</button>`).join(' ') : 'no gap long enough.'}</div>`;
      $('#mClash').querySelectorAll('[data-gap]').forEach(b => b.onclick = () => { $('#mTm').value = b.dataset.gap; check(); });
      $('#mOk').textContent = cl.length ? 'Log anyway' : 'Log lesson';
    };
    ['mT', 'mSt', 'mD'].forEach(i => $('#' + i).onchange = () => { info(); check(); }); $('#mSs').onchange = info; $('#mDu').oninput = e => { e.target.dataset.touched = '1'; check(); }; $('#mTm').oninput = check; $('#mTm').onchange = check; check();
    $('#mOk').onclick = async () => {
      const sid = $('#mSt').value, tid = $('#mT').value, d = $('#mD').value; if (!sid || !d) return toast('Choose a student and date');
      const st = $('#mSs').value; const p = (makesUp(sid, tid, d, st) ? makeupPkg : pkgForDate)(sid, tid, d); if (!p) return toast('This student has no package with this teacher');
      if (pairPkgs(sid, tid).some(x => entryFor(x, d))) return toast('A lesson is already logged for that date. Edit it in the package.');
      const no = $('#mNo').value.trim(), tm = $('#mTm').value || null, du = Math.max(5, Math.min(240, +$('#mDu').value || 45)); closeOverlay();
      await setLog(p.id, d, st, no, tm, du).then(() => toast('Lesson logged')).catch(() => {});
    };
  } else if (kind === 'trial') {
    // A trial is its own thing: a one-lesson Trial package with that lesson booked on a date and time.
    const fixed = ctx.pid && S.packages[ctx.pid] ? { id: ctx.pid, ...S.packages[ctx.pid] } : null; let tp = fixed;
    shell(fixed ? 'Book trial time' : 'Book trial lesson', '', `<div class="grid2"><label class="f">Student<select id="mSt" ${fixed ? 'disabled' : ''}>${stuOptions(ctx.studentId || '')}</select></label><label class="f">Teacher<select id="mT">${teaOptions(ctx.teacherId || S.weekTeacher || teacherIds()[0])}</select></label>
     <label class="f">Date<input type="date" id="mD" min="${kwToday()}" value="${esc(ctx.date || kwToday())}"></label><label class="f">Time<input type="time" id="mTm" step="300"></label>
     <label class="f">Length (min)<input type="number" id="mDu" min="5" max="240" step="5" value="30"></label>
     ${fixed ? '' : `<label class="f" data-newtrial>Price (KWD)<input type="number" id="mPr" min="0" step="0.001"></label><label class="f" data-newtrial>Payment<select id="mP">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === 'unpaid' ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>`}</div>
     <label class="f">Note<input type="text" id="mNo" placeholder="e.g. piano, beginner"></label>
     <div id="mHas" class="infobox" hidden></div>
     ${fixed ? '' : '<p class="small muted" style="margin:0">New student? Add them first in Students, then book the trial.</p>'}
     <div id="mClash"></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Book trial</button></div>`, true);
    const check = () => {
      const sid = $('#mSt').value, tid = $('#mT').value, d = $('#mD').value, tm = $('#mTm').value, du = Math.max(5, Math.min(240, +$('#mDu').value || 30));
      // A student who already has a trial package with nothing booked gets the time added to it, not a second package.
      tp = fixed || (sid ? pkgList().filter(p => p.studentId === sid && p.kind === 'trial' && !p.closed && !(p.log || []).length).sort((a, b) => (a.start || '').localeCompare(b.start || ''))[0] : null) || null;
      document.querySelectorAll('[data-newtrial]').forEach(el => { el.hidden = !!tp; });
      $('#mHas').hidden = !tp; if (tp) { const ps = stats(tp); $('#mHas').innerHTML = `Books the time on ${esc(sname(tp.studentId))}'s trial package ${esc(pkgRef(tp))}${tp.price != null ? ` · ${esc(kd(tp.price))}` : ''} · ${esc(PAY[tp.payment]?.[0] || '')}${ps.paidSum ? ` (${esc(kd(ps.paidSum))} recorded)` : ''}. No new package or payment.`; }
      if (!tid || !d) { $('#mClash').innerHTML = ''; return; }
      const cl = tm ? clashesFor(tid, sid, d, tm, du) : []; const gaps = freeGaps(tid, d, du);
      $('#mClash').innerHTML = (cl.length ? `<div class="warnbox" role="alert" style="margin-top:8px"><b>⚠ Clash.</b> ${esc(clashText(cl, tid))}. Pick a free time below, or book it anyway if this is intended.</div>` : tm ? `<div class="small" style="color:var(--ok)">✓ ${esc(tname(tid))}${sid ? ` and ${esc(sname(sid))} are` : ' is'} free at this time.</div>` : '')
        + `<div class="small muted" style="margin-top:6px">Free for ${esc(tname(tid))} on ${esc(fmtD(d))}: ${gaps.length ? gaps.map(([a, b]) => `<button type="button" class="btn sm ghost" data-gap="${toT(a)}" title="Use ${esc(fmtT(a))}">${fmtTs(a)}–${fmtT(b)}</button>`).join(' ') : 'no gap long enough.'}</div>`;
      $('#mClash').querySelectorAll('[data-gap]').forEach(b => b.onclick = () => { $('#mTm').value = b.dataset.gap; check(); });
      $('#mOk').textContent = cl.length ? 'Book anyway' : 'Book trial';
    };
    ['mT', 'mSt', 'mD'].forEach(i => $('#' + i).onchange = check); $('#mDu').oninput = check; $('#mTm').oninput = check; $('#mTm').onchange = check; check();
    $('#mOk').onclick = async () => {
      const sid = tp ? tp.studentId : $('#mSt').value, tid = $('#mT').value, d = $('#mD').value, tm = $('#mTm').value;
      if (!sid) return toast('Choose a student'); if (!tid) return toast('Add a teacher first'); if (!d) return toast('Pick the trial date'); if (isPast(d)) return toast('Pick today or a later date'); if (!tm) return toast('Pick the trial time');
      const btn = $('#mOk'); if (btn.disabled) return; btn.disabled = true;
      const du = Math.max(5, Math.min(240, +$('#mDu').value || 30)); const note = $('#mNo').value.trim();
      const id = tp ? tp.id : `${tid}--${sid}--${Date.now().toString(36)}`;
      try {
        if (tp) await run(sb.from('packages').update({ teacher_id: tid, start_date: d, end_date: d }).eq('id', id));
        else await run(sb.from('packages').insert({ id, student_id: sid, teacher_id: tid, subject: '', kind: 'trial', sessions: 1, per_week: 1, start_date: d, end_date: d, term: '', payment: $('#mP').value, price: $('#mPr').value === '' ? null : +$('#mPr').value, notes: note }));
        await run(sb.from('lessons').insert({ package_id: id, lesson_date: d, status: 'present', note: note || 'Trial lesson', start_time: tm, dur: du }));
        toast(`Trial booked: ${sname(sid)} with ${tname(tid)}, ${fmtD(d)} at ${fmtT(tm)}`); closeOverlay();
      } catch (e) { btn.disabled = false; }
    };
  } else if (kind === 'resched') {
    // Move an upcoming makeup to another date or time. It stays the same lesson, so the makeup owed is unchanged.
    const p = S.packages[ctx.pid]; const e = (p?.log || []).find(x => x.id === ctx.lessonId);
    if (!p || !e) { closeOverlay(); return toast('That lesson no longer exists'); }
    const tid = p.teacherId, sid = p.studentId;
    const what = p.kind === 'trial' ? 'trial' : 'makeup';
    shell(`Reschedule ${what}`, '', `<p class="small muted" style="margin:0 0 8px">${esc(sname(sid))} with ${esc(tname(tid))} · now ${esc(fmtD(e.d))}${e.t ? ' ' + esc(fmtT(e.t)) : ''}</p><div class="grid2"><label class="f">New date<input type="date" id="mD" min="${kwToday()}" value="${esc(e.d)}"></label><label class="f">Time<input type="time" id="mTm" step="300" value="${esc(e.t || '')}"></label>
     <label class="f">Length (min)<input type="number" id="mDu" min="5" max="240" step="5" value="${e.du || defDur(sid, tid)}"></label></div>
     <div id="mClash"></div><div class="row-end">${cancel}<button class="btn primary" id="mOk">Reschedule</button></div>`, true);
    const check = () => {
      const d = $('#mD').value, tm = $('#mTm').value, du = Math.max(5, Math.min(240, +$('#mDu').value || 45)); if (!d) { $('#mClash').innerHTML = ''; return; }
      const cl = tm ? clashesFor(tid, sid, d, tm, du, e.id) : []; const gaps = freeGaps(tid, d, du);
      $('#mClash').innerHTML = (cl.length ? `<div class="warnbox" role="alert" style="margin-top:8px"><b>⚠ Clash.</b> ${esc(clashText(cl, tid))}. Pick a free time below, or reschedule anyway if this is intended.</div>` : tm ? `<div class="small" style="color:var(--ok)">✓ ${esc(tname(tid))} and ${esc(sname(sid))} are free at this time.</div>` : '')
        + `<div class="small muted" style="margin-top:6px">Free for ${esc(tname(tid))} on ${esc(fmtD(d))}: ${gaps.length ? gaps.map(([a, b]) => `<button type="button" class="btn sm ghost" data-gap="${toT(a)}" title="Use ${esc(fmtT(a))}">${fmtTs(a)}–${fmtT(b)}</button>`).join(' ') : 'no gap long enough.'}</div>`;
      $('#mClash').querySelectorAll('[data-gap]').forEach(b => b.onclick = () => { $('#mTm').value = b.dataset.gap; check(); });
      $('#mOk').textContent = cl.length ? 'Reschedule anyway' : 'Reschedule';
    };
    $('#mD').onchange = check; $('#mDu').oninput = check; $('#mTm').oninput = check; $('#mTm').onchange = check; check();
    $('#mOk').onclick = async () => {
      const d = $('#mD').value, tm = $('#mTm').value || null, du = Math.max(5, Math.min(240, +$('#mDu').value || 45));
      if (!d) return toast('Pick a date'); if (isPast(d)) return toast('Pick today or a later date');
      if (d === e.d && tm === (e.t || null) && du === (e.du || defDur(sid, tid))) return closeOverlay();
      if (d !== e.d && pairPkgs(sid, tid).some(x => entryFor(x, d))) return toast('A lesson is already logged for that date');
      if (d !== e.d && slotsOf(tid).some(x => x.studentId === sid && x.day === wd(d))) return toast(`${sname(sid)} already has a weekly lesson with ${tname(tid)} on ${DAYS[wd(d)]}s. Pick another day.`);
      const moved = d !== e.d ? `Moved from ${fmtD(e.d)}` : ''; const note = moved ? [e.n, moved].filter(Boolean).join(' · ') : e.n || '';
      closeOverlay();
      await run(sb.from('lessons').update({ lesson_date: d, start_time: tm, dur: tm ? du : null, note }).eq('id', e.id), `${what === 'trial' ? 'Trial' : 'Makeup'} rescheduled`).catch(() => {});
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
  if (e.target.closest('a.pbtn')) return;
  const t = e.target.closest('[data-att-report],[data-pay-receipt],[data-open-pkg],[data-open-stu],[data-mark],[data-new-pkg],[data-goto-date],[data-add-slot],[data-edit-slot],[data-close],[data-resched],[data-book-trial]'); if (!t) return;
  if (t.hasAttribute('data-close')) return closeOverlay();
  if (t.dataset.attReport) { const [sid, pid] = t.dataset.attReport.split('|'); return openModal('report', { sid, pids: pid ? [pid] : payPkgs(sid).filter(p => !p.closed).map(p => p.id) }); }
  if (t.dataset.payReceipt) { e.preventDefault(); e.stopPropagation(); return openModal('receipt', { payId: t.dataset.payReceipt }); }
  if (t.dataset.openPkg) { e.preventDefault(); return openDrawer('package', t.dataset.openPkg); }
  if (t.dataset.openStu) { e.preventDefault(); return openDrawer('student', t.dataset.openStu); }
  if (t.dataset.bookTrial) { const p = S.packages[t.dataset.bookTrial]; return openModal('trial', { pid: t.dataset.bookTrial, studentId: p?.studentId, teacherId: p?.teacherId, date: p?.start && !isPast(p.start) ? p.start : kwToday() }); }
  if (t.dataset.newPkg) { const [sid, tid] = t.dataset.newPkg.split('|'); return openModal('newpkg', { studentId: sid, teacherId: tid }); }
  if (t.dataset.resched) { e.preventDefault(); const [pid, lessonId] = t.dataset.resched.split('|'); return openModal('resched', { pid, lessonId }); }
  if (t.dataset.gotoDate) { S.date = t.dataset.gotoDate; S.tab = 'today'; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.addSlot) { const [d, st] = t.dataset.addSlot.split('|'); return openModal('slot', { teacherId: S.weekTeacher, day: +d, start: st }); }
  if (t.dataset.editSlot) return openModal('slot', { teacherId: S.weekTeacher, slotId: t.dataset.editSlot });
  if (t.dataset.mark) {
    const [pid, d, k, unmark] = t.dataset.mark.split('|'); const cur = entryFor(S.packages[pid], d); const next = cur?.s === k ? unmark || null : k;
    if (cur && isPast(d)) { if (!isAdmin()) return toast('Past attendance is locked. Ask a super admin to correct it.'); return openModal('correct', { pid, lessonId: cur.id, status: next }); }
    t.closest('.seg')?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await setLog(pid, d, next); } catch (err) { render(); }
  }
});

/* ---------- export ---------- */
async function exportXlsx() {
  try { await exportXlsxInner(); } catch (e) { console.error(e); toast('Export failed. Please try again.'); }
}
const STATE_LABEL = { active: 'Active', low: 'Nearly done', finished: 'Finished', closed: 'Closed' };
async function exportXlsxInner() {
  const X = await import('xlsx');
  const used = new Set();
  const sheetName = n => { let base = String(n || '').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 28) || 'Sheet'; let name = base, i = 2; while (used.has(name.toLowerCase())) name = `${base} (${i++})`; used.add(name.toLowerCase()); return name; };
  ['Attendance', 'Students', 'Payments', 'Expenses'].forEach(n => used.add(n.toLowerCase()));
  const wb = X.utils.book_new();
  const att = [['Ref', 'Teacher', 'Student', 'Subject', 'Type', 'Term', 'Start', 'End', 'Lessons', 'Used', 'Left', 'Makeups owed', 'Payment', 'Status', 'Lessons logged']];
  for (const p of pkgList().sort((a, b) => tname(a.teacherId).localeCompare(tname(b.teacherId)) || sname(a.studentId).localeCompare(sname(b.studentId)))) {
    const s = stats(p);
    att.push([pkgRef(p), tname(p.teacherId), sname(p.studentId), p.subject || '', KINDS[p.kind] || p.kind, p.term || '', p.start || '', p.end || '', s.total, s.used, s.left, s.owed, PAY[p.payment]?.[0] || '', p.closed ? 'Closed' : (STATE_LABEL[s.state] || s.state) + (s.ended ? ' (end date passed)' : ''), ...(p.log || []).map(e => `${e.d}${e.s === 'present' ? '' : ' (' + (ST[e.s]?.seg || e.s) + ')'}`)]);
  }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(att), 'Attendance');
  for (const t of teacherIds()) {
    const sl = slotsOf(t); if (!sl.length) continue; const times = [...new Set(sl.map(s => s.start))].sort(); const days = [0, 1, 2, 3, 4, 5, 6].filter(d => sl.some(s => s.day === d));
    const rows = [['Time', ...days.map(d => DAYS[d])], ...times.map(tm => [fmtT(tm), ...days.map(d => { const s = sl.find(x => x.day === d && x.start === tm); return s ? slotLabel(s) + (s.status === 'tentative' ? ' (not confirmed)' : '') : ''; })])];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), sheetName(tname(t)));
  }
  const st = [['Student', 'Parent / Guardian', 'Phone', 'Registration form', 'Notes', 'Archived']];
  for (const id of studentIds(true)) { const s = S.students[id]; st.push([s.name, s.guardian || '', s.phone || '', FORM[s.regForm]?.[0] || '', s.notes || '', s.archived ? 'Yes' : '']); }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(st), 'Students');
  const pays = [['Receipt', 'Student', 'Package ref', 'Teacher', 'Amount (KD)', 'For', 'Method', 'Status', 'Paid on', 'Note', 'Void reason']];
  for (const x of S.payments) pays.push([rcptNo(x), sname(x.student_id), pkgRef(S.packages[x.package_id]), payTeacher(x) ? tname(payTeacher(x)) : '', x.status === 'void' ? 0 : Number(x.amount), PKIND[x.kind] || x.kind, x.method || '', ({ paid: 'Paid', pending: 'Pending', void: `Voided (was ${x.amount} KD)` })[x.status] || x.status, x.paid_on || '', x.note || '', x.void_reason || '']);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(pays), 'Payments');
  if (S.expenses) {
    const exs = [['Date', 'Amount (KD)', 'Category', 'Teacher', 'Paid to', 'Method', 'Status', 'Note', 'Void reason']];
    for (const x of S.expenses) exs.push([x.spent_on || '', x.status === 'void' ? 0 : Number(x.amount), EXCAT[x.category] || x.category, x.teacher_id ? tname(x.teacher_id) : '', x.payee || '', x.method || '', x.status === 'void' ? `Voided (was ${x.amount} KD)` : 'Paid', x.note || '', x.void_reason || '']);
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(exs), 'Expenses');
  }
  X.writeFile(wb, `studio-${kwToday()}.xlsx`);
  sb.rpc('log_event', { p_action: 'EXPORT', p_detail: { file: `studio-${kwToday()}.xlsx`, packages: pkgList().length } }).then(() => {}, () => {});
}

/* ---------- start ---------- */
try { const t = localStorage.getItem('sd-tab'); if (t && ['today', 'week', 'packages', 'students', 'payments', 'history', 'setup'].includes(t)) S.tab = t; } catch (e) { /* ignore */ }
render();
