// Lớp dữ liệu: Supabase (Postgres + Storage) khi có SUPABASE_URL, ngược lại dùng bộ nhớ tạm.
// ponytail: chế độ bộ nhớ chỉ để chạy thử/kiểm thử, dữ liệu mất khi tắt máy chủ.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const BUCKET = 'media';
const sb = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
export const mode = sb ? 'supabase' : 'memory';

const must = ({ data, error }) => { if (error) throw new Error('Supabase: ' + error.message); return data; };
const row = r => (r ? r.data : null);

// ---------- bộ nhớ tạm ----------
const M = { users: new Map(), sessions: new Map(), assignments: new Map(), subs: new Map(), classes: new Map(), files: new Map(), tokens: new Map() };
const clone = v => (v == null ? v : structuredClone(v));

// ---------- người dùng ----------
export async function getUser(u) {
  if (!sb) return clone(M.users.get(u) || null);
  return must(await sb.from('users').select('*').eq('username', u).maybeSingle());
}
export async function hasTeacher() {
  if (!sb) return [...M.users.values()].some(x => x.role === 'teacher');
  return must(await sb.from('users').select('username').eq('role', 'teacher').limit(1)).length > 0;
}
export async function students() {
  if (!sb) return [...M.users.values()].filter(x => x.role === 'student').sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(clone);
  return must(await sb.from('users').select('*').eq('role', 'student').order('name'));
}
export async function insertUser(r) {
  if (!sb) { if (M.users.has(r.username)) throw new Error('duplicate'); M.users.set(r.username, { bonus: 0, ...r }); return; }
  must(await sb.from('users').insert(r));
}
export async function updateUser(u, patch) {
  if (!sb) { Object.assign(M.users.get(u), patch); return; }
  must(await sb.from('users').update(patch).eq('username', u));
}
export async function deleteUser(u) { // phiên đăng nhập và bài nộp tự xóa theo (on delete cascade)
  if (!sb) { M.users.delete(u); for (const [t, s] of M.sessions) if (s === u) M.sessions.delete(t); for (const [k, s] of M.subs) if (s.student === u) M.subs.delete(k); return; }
  must(await sb.from('users').delete().eq('username', u));
}

// ---------- phiên đăng nhập ----------
export async function addSession(token, u) {
  if (!sb) { M.sessions.set(token, u); return; }
  must(await sb.from('sessions').insert({ token, username: u, created: Date.now() }));
}
export async function sessionUser(token) {
  if (!sb) { const u = M.sessions.get(token); return u ? getUser(u) : null; }
  const s = must(await sb.from('sessions').select('username').eq('token', token).maybeSingle());
  return s ? getUser(s.username) : null;
}
export async function delSession(token) {
  if (!sb) { M.sessions.delete(token); return; }
  must(await sb.from('sessions').delete().eq('token', token));
}
export async function delSessionsOf(u) {
  if (!sb) { for (const [t, s] of M.sessions) if (s === u) M.sessions.delete(t); return; }
  must(await sb.from('sessions').delete().eq('username', u));
}

// ---------- bài tập ----------
export async function allA() {
  if (!sb) return [...M.assignments.values()].map(clone);
  return must(await sb.from('assignments').select('data')).map(row);
}
export async function getA(id) {
  if (!sb) return clone(M.assignments.get(id) || null);
  return row(must(await sb.from('assignments').select('data').eq('id', id).maybeSingle()));
}
export async function putA(a) {
  if (!sb) { M.assignments.set(a.id, clone(a)); return; }
  must(await sb.from('assignments').upsert({ id: a.id, data: a }));
}
export async function delA(id) { // bài nộp tự xóa theo (on delete cascade)
  if (!sb) { M.assignments.delete(id); for (const [k, s] of M.subs) if (s.aid === id) M.subs.delete(k); return; }
  must(await sb.from('assignments').delete().eq('id', id));
}

// ---------- lớp ----------
export async function allClasses() {
  if (!sb) return [...M.classes.values()].map(clone);
  return must(await sb.from('classes').select('*').order('created'));
}
export async function putClass(c) {
  if (!sb) { M.classes.set(c.id, clone(c)); return; }
  must(await sb.from('classes').upsert(c));
}
export async function delClass(id) {
  if (!sb) { M.classes.delete(id); return; }
  must(await sb.from('classes').delete().eq('id', id));
}

// ---------- bài nộp ----------
export const subKey = (aid, u) => aid + '::' + u;
export async function allSubs() {
  if (!sb) return [...M.subs.values()].map(clone);
  return must(await sb.from('subs').select('data')).map(row);
}
export async function subsWhere(col, v) { // col: 'username' | 'aid'
  if (!sb) return [...M.subs.values()].filter(s => (col === 'aid' ? s.aid : s.student) === v).map(clone);
  return must(await sb.from('subs').select('data').eq(col, v)).map(row);
}
export async function getS(aid, u) {
  if (!sb) return clone(M.subs.get(subKey(aid, u)) || null);
  return row(must(await sb.from('subs').select('data').eq('key', subKey(aid, u)).maybeSingle()));
}
export async function putS(s) {
  if (!sb) { M.subs.set(s.key, clone(s)); return; }
  must(await sb.from('subs').upsert({ key: s.key, aid: s.aid, username: s.student, data: s }));
}
export async function delS(key) {
  if (!sb) { M.subs.delete(key); return; }
  must(await sb.from('subs').delete().eq('key', key));
}

// ---------- file (audio, ảnh, ghi âm): bucket riêng tư, chỉ truy cập qua link ký tạm ----------
// trình duyệt tải thẳng lên Supabase bằng link ký, không đi qua máy chủ
export async function signUpload(path) {
  if (!sb) { const t = randomBytes(16).toString('hex'); M.tokens.set(t, { path, up: true }); return `/api/_mem/${t}`; }
  return must(await sb.storage.from(BUCKET).createSignedUploadUrl(path)).signedUrl;
}
const urlCache = new Map(); // dùng lại link cũ để trình duyệt lưu đệm được
export async function signUrls(paths, sec = 6 * 3600) {
  const out = {}, need = [], now = Date.now();
  for (const p of new Set(paths.filter(Boolean))) {
    const c = urlCache.get(p);
    if (c && c.exp - now > 3600e3 && sec >= 3600) out[p] = c.url; else need.push(p);
  }
  if (!need.length) return out;
  if (!sb) {
    for (const p of need) { const t = randomBytes(16).toString('hex'); M.tokens.set(t, { path: p }); out[p] = `/api/_mem/${t}`; }
    return out;
  }
  for (const r of must(await sb.storage.from(BUCKET).createSignedUrls(need, sec))) {
    if (!r.signedUrl) continue;
    out[r.path] = r.signedUrl;
    if (sec >= 3600) urlCache.set(r.path, { url: r.signedUrl, exp: now + sec * 1000 });
  }
  return out;
}
export async function download(path) {
  if (!sb) return M.files.get(path)?.buf || null;
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  return error ? null : Buffer.from(await data.arrayBuffer());
}
export async function removeFiles(paths) {
  paths = paths.filter(Boolean);
  if (!paths.length) return;
  paths.forEach(p => urlCache.delete(p));
  if (!sb) { paths.forEach(p => M.files.delete(p)); return; }
  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error) console.error('Không xóa được file', error.message);
}
// chỉ dùng ở chế độ bộ nhớ: nhận/gửi file thay cho Supabase Storage
export const memFile = {
  put(token, mime, buf) { const t = M.tokens.get(token); if (!t || !t.up) return false; M.tokens.delete(token); M.files.set(t.path, { mime, buf }); return true; },
  get(token) { const t = M.tokens.get(token); return t && !t.up ? M.files.get(t.path) || null : null; },
};
