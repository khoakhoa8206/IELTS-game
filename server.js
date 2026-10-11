// IELTS Quest API: tài khoản, bài tập, bài nộp, chấm điểm, mạng, báo phụ huynh, AI chấm Writing.
// Chạy: npm start. Dữ liệu ở Supabase (xem supabase/schema.sql); không cấu hình thì chạy bằng bộ nhớ tạm.
import http from 'node:http';
import fs from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as AI from './ai.js';
import { listMusic, MUSIC_DIR, AUDIO_TYPE } from './make-playlist.js';
import * as db from './db.js';

const PORT = +process.env.PORT || 3000;
if (process.env.RENDER && db.mode === 'memory') { // trên Render mà thiếu Supabase thì dừng hẳn, tránh mất dữ liệu
  console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Hãy điền trong Render → Environment.');
  process.exit(1);
}
const SKS = ['reading', 'listening', 'writing', 'speaking'];
const LIVES = 3, MAX_LISTENS = 2;

// ===== mật khẩu =====
const hashPw = pw => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(pw, salt, 32).toString('hex'); };
const checkPw = (pw, stored) => {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  return timingSafeEqual(scryptSync(String(pw), salt, 32), Buffer.from(h, 'hex'));
};
const PW_CHARS = 'abcdefghkmnpqrstuvwxyz23456789'; // bỏ các ký tự dễ nhầm (0/o, 1/l/i)
const genPw = () => Array.from(randomBytes(6), b => PW_CHARS[b % PW_CHARS.length]).join('');
const START_PW = '1'; // mật khẩu ban đầu của học sinh, phải đổi ở lần đăng nhập đầu

// ===== chấm điểm Reading / Listening (trên máy chủ, học sinh không thấy đáp án) =====
const hasAns = v => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
const norm = s => String(s ?? '').toLowerCase().replace(/[“”"‘’']/g, '').replace(/[.,;:!?()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);
const lines = t => String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const countGaps = html => (String(html || '').match(/_{3,}/g) || []).length;
const marksOf = (g, it) => (g.type === 'multi' ? it.choose || 2 : 1);

// mỗi nhóm câu theo đúng form IELTS; multi (Choose TWO/THREE) tính mỗi chữ cái đúng 1 điểm
function gradeGroups(groups, ans) {
  let score = 0, total = 0; const marks = {};
  for (const g of groups || []) for (const it of g.items || []) {
    const a = ans[it.id], of = marksOf(g, it); let got;
    if (g.type === 'multi') {
      const key = new Set((it.answer || []).map(Number));
      got = [...new Set((Array.isArray(a) ? a : []).map(Number))].slice(0, of).filter(x => key.has(x)).length;
    } else if (g.type === 'gap' && !(g.bank || []).length) {
      const ok = String(it.answer || '').split('|').map(norm).filter(Boolean).includes(norm(a));
      got = ok && (!g.maxWords || words(a).length <= g.maxWords) ? 1 : 0; // quá số từ cho phép là sai, như thi thật
    } else got = hasAns(a) && String(a) === String(it.answer) ? 1 : 0;
    marks[it.id] = [got, of]; score += got; total += of;
  }
  return { score, total, errors: total - score, marks };
}
// chính tả: so từng từ bằng LCS → ok / miss (thiếu) / extra (thừa) / sub (sai)
function diffWords(ref, hyp) {
  const n = ref.length, m = hyp.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ref[i] === hyp[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (ref[i] === hyp[j]) { ops.push({ t: 'ok', w: ref[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: 'miss', w: ref[i++] });
    else ops.push({ t: 'extra', w: hyp[j++] });
  }
  while (i < n) ops.push({ t: 'miss', w: ref[i++] });
  while (j < m) ops.push({ t: 'extra', w: hyp[j++] });
  const out = [];
  for (let k = 0; k < ops.length; k++) {
    const a = ops[k], b = ops[k + 1];
    if (a.t === 'miss' && b && b.t === 'extra') { out.push({ t: 'sub', ref: a.w, hyp: b.w }); k++; }
    else if (a.t === 'extra' && b && b.t === 'miss') { out.push({ t: 'sub', ref: b.w, hyp: a.w }); k++; }
    else out.push(a);
  }
  return out;
}
function gradeDictation(transcript, typed) {
  let ok = 0, total = 0, errors = 0; const dict = [];
  lines(transcript).forEach((l, i) => {
    const ref = words(l), ops = diffWords(ref, words((typed || [])[i]));
    total += ref.length; ops.forEach(o => (o.t === 'ok' ? ok++ : errors++)); dict.push(ops);
  });
  return { score: ok, total, errors, dict, accuracy: total ? Math.round(ok / total * 100) : 0 };
}

// ===== file đính kèm (lưu ở Storage, gửi cho trình duyệt bằng link ký tạm) =====
// Writing có 2 task; bài soạn trước đây chỉ có 1 đề (a.prompt) thì coi là 1 task
const tasksOf = a => (Array.isArray(a.tasks) && a.tasks.length ? a.tasks : a.prompt || (a.images || []).length ? [{ no: (a.images || []).length ? 1 : 2, prompt: a.prompt, images: a.images || [], minWords: a.minWords }] : []);
const essaysOf = s => (s?.writing?.tasks ? s.writing.tasks : s?.writing?.html ? [{ html: s.writing.html, words: s.writing.words }] : []);
const mediaOf = a => [a.audio, ...(a.images || []), ...(a.tasks || []).flatMap(t => t.images || []), ...(a.groups || []).map(g => g.image)].filter(p => typeof p === 'string' && p && !p.startsWith('data:'));
// xóa file đề (audio, ảnh) chỉ khi không còn bài nào khác dùng tới
async function dropUnusedMedia(paths) {
  if (!paths.length) return;
  const used = new Set((await db.allA()).flatMap(mediaOf));
  await db.removeFiles(paths.filter(x => !used.has(x)));
}
const recsOf = s => Object.values(s?.speaking?.items || {}).map(it => it.path);
async function withUrls(list, pathsOf) {
  const urls = await db.signUrls(list.flatMap(pathsOf));
  return list.map(x => ({ ...x, _urls: Object.fromEntries(pathsOf(x).filter(p => urls[p]).map(p => [p, urls[p]])) }));
}
// bản đề gửi cho học sinh chưa nộp: bỏ đáp án, transcript và link audio (audio lấy qua /api/listen để đếm lượt nghe)
function forStudent(a, sub) {
  if (sub && sub.status === 'submitted') return a;
  const c = structuredClone(a);
  for (const g of c.groups || []) for (const it of g.items || []) delete it.answer;
  if (c.transcript) { c.lineWords = lines(c.transcript).map(l => words(l).length); delete c.transcript; }
  if (c.skill === 'listening') { c.hasAudio = !!c.audio; delete c.audio; }
  return c;
}

// ===== 3 mạng: mỗi bài trễ hạn (nộp sau hạn, hoặc quá hạn mà chưa nộp) mất 1 mạng =====
function livesOf(user, as, subs) {
  const now = Date.now(), by = Object.fromEntries(subs.filter(s => s.student === user.username).map(s => [s.aid, s]));
  const lates = as.filter(a => {
    if (!a.published || !a.deadline) return false;
    const s = by[a.id], t = s && s.status === 'submitted' ? s.submittedAt : now;
    return t > a.deadline;
  });
  return { hearts: Math.max(0, Math.min(LIVES, LIVES + (user.bonus || 0) - lates.length)), lates };
}

// hết mạng → hiện cho cô ở tab HỌC SINH kèm số điện thoại phụ huynh để gọi, gọi xong cô khôi phục mạng
const vnTime = ts => new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const notifyParent = s => `Hết mạng lúc ${vnTime(Date.now())}. ` + (s.parent_phone ? `Cô hãy gọi phụ huynh: ${s.parent_phone}.` : 'Chưa có số điện thoại phụ huynh.');
let lastCheck = 0, checking = null;
function checkLives() { // chạy khi có người dùng truy cập, tối đa 1 lần/phút (Render free có thể ngủ nên không dùng hẹn giờ)
  if (checking || Date.now() - lastCheck < 60e3) return checking;
  lastCheck = Date.now();
  checking = (async () => {
    const [st, as, subs] = await Promise.all([db.students(), db.allA(), db.allSubs()]);
    for (const s of st) {
      const l = livesOf(s, as, subs);
      if (l.hearts === 0 && !s.zero_at) await db.updateUser(s.username, { zero_at: Date.now(), notify_status: notifyParent(s) });
    }
  })().catch(e => console.error('Kiểm tra mạng lỗi', e)).finally(() => { checking = null; });
  return checking;
}

const textOf = html => String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();
const wordCount = t => (String(t).match(/\S+/g) || []).length;

// ===== bài tập phải đầy đủ mới được giao =====
function groupProblems(a, n) {
  const p = [], gs = a.groups || [];
  if (!gs.length) p.push(n + 'chưa có câu hỏi');
  gs.forEach((g, gi) => {
    const m = `${n}nhóm câu ${gi + 1}: `, its = g.items || [];
    if (!its.length) p.push(m + 'chưa có câu nào');
    if (g.type === 'match') {
      if ((g.options || []).length < 2) p.push(m + 'cần ít nhất 2 lựa chọn');
      else if (!g.image && g.options.some(o => !String(o).trim())) p.push(m + 'có lựa chọn còn trống');
    }
    if (g.type === 'gap' && countGaps(g.html) !== its.length) p.push(m + 'số chỗ trống ___ không khớp số đáp án');
    if (g.type === 'gap' && (g.bank || []).some(o => !String(o).trim())) p.push(m + 'khung từ có ô trống');
    its.forEach((it, i) => {
      const k = `${m}câu ${i + 1} `;
      if (g.type !== 'gap' && !String(it.text || '').trim()) p.push(k + 'chưa có nội dung');
      if ((g.type === 'mcq' || g.type === 'multi') && ((it.options || []).length < 2 || it.options.some(o => !String(o).trim()))) p.push(k + 'cần nhập đủ các phương án');
      if (g.type === 'multi') { if (!Array.isArray(it.answer) || it.answer.length !== (it.choose || 2)) p.push(k + `cần chọn đúng ${it.choose || 2} đáp án`); }
      else if (!hasAns(it.answer)) p.push(k + 'chưa có đáp án');
    });
  });
  return p;
}
const passagesOf = a => (Array.isArray(a.passages) && a.passages.length ? a.passages : a.passage ? [a.passage] : []);
function problems(a) {
  const p = [], n = `${String(a.skill).toUpperCase()} · "${a.title || '(chưa đặt tên)'}": `;
  if (!SKS.includes(a.skill)) return [n + 'kỹ năng không hợp lệ'];
  if (!String(a.title || '').trim()) p.push(n + 'chưa có tên bài');
  if (!a.deadline) p.push(n + 'chưa đặt hạn nộp');
  else if (!a.published && a.deadline < Date.now()) p.push(n + 'hạn nộp đã qua, hãy đặt hạn mới');
  if (a.skill === 'reading') {
    const ps = passagesOf(a);
    if (!ps.some(h => textOf(h) || /<img/i.test(h))) p.push(n + 'chưa có bài đọc');
    ps.forEach((h, i) => { if (!textOf(h) && !/<img/i.test(h)) p.push(`${n}passage ${i + 1} còn trống`); });
    if ((a.groups || []).some(g => (g.section || 1) > ps.length)) p.push(n + 'có nhóm câu gắn với passage không tồn tại');
    p.push(...groupProblems(a, n));
  }
  if (a.skill === 'listening') {
    if (!a.audio) p.push(n + 'chưa có file nghe');
    if (a.mode === 'dictation') { if (!lines(a.transcript).length) p.push(n + 'chưa có bản gốc cho bài chép chính tả'); }
    else p.push(...groupProblems(a, n));
  }
  if (a.skill === 'writing' && !tasksOf(a).some(t => textOf(t.prompt) || (t.images || []).length)) p.push(n + 'chưa có đề bài');
  if (a.skill === 'speaking') {
    if (!(a.questions || []).length) p.push(n + 'chưa có câu hỏi');
    else if (a.questions.some(x => !String(x.text || '').trim())) p.push(n + 'có câu hỏi chưa có nội dung');
  }
  return p;
}

// ===== AI chấm Writing (OpenRouter, xem ai.js) =====
const ai = AI.enabled;
const MIME_OF = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };
const mimeOf = p => MIME_OF[String(p).split('.').pop().toLowerCase()];
// band Writing tổng: Task 2 tính gấp đôi Task 1, làm tròn tới 0.5 như IELTS
function overallBand(tasks, bands) {
  let sum = 0, w = 0;
  tasks.forEach((t, i) => { const b = parseFloat(bands[i]); if (isNaN(b)) return; const k = t.no === 2 ? 2 : 1; sum += b * k; w += k; });
  return w ? String(Math.round(sum / w * 2) / 2) : '';
}
async function aiGrade(aid, u) {
  const [a, s] = await Promise.all([db.getA(aid), db.getS(aid, u)]);
  if (!ai || !a || !s || !s.writing) return;
  let patch;
  try {
    const tasks = tasksOf(a), essays = essaysOf(s), out = [];
    for (let i = 0; i < tasks.length; i++) { // chấm lần lượt từng task (bản AI miễn phí giới hạn số lượt mỗi phút)
      const t = tasks[i], e = essays[i] || { html: '', words: 0 };
      if (!e.words) { out.push({ band: '0', comment: '<p>Em chưa làm task này.</p>', html: '' }); continue; }
      const images = [];
      for (const img of t.images || []) {
        if (img.startsWith('data:')) { images.push({ type: 'image_url', image_url: { url: img } }); continue; }
        const buf = await db.download(img);
        if (buf && mimeOf(img)) images.push(AI.filePart(img, mimeOf(img), buf));
      }
      out.push(await AI.gradeWriting({ taskNo: t.no, task: textOf(t.prompt), minWords: t.minWords, essay: textOf(e.html), words: e.words, images }));
    }
    patch = { aiStatus: 'done', feedback: { tasks: out, band: overallBand(tasks, out.map(x => x.band)), by: 'ai', updatedAt: Date.now() } };
  } catch (e) {
    console.error('AI chấm lỗi', aid, u, e);
    patch = { aiStatus: 'error', aiError: String(e.message || e) };
  }
  const cur = await db.getS(aid, u);
  if (cur && !(cur.feedback && cur.feedback.by === 'teacher')) await db.putS(Object.assign(cur, patch)); // không ghi đè điểm cô đã chấm
}

// ===== AI đọc đề: chạy nền vì một đề 40 câu mất 1–3 phút (Netlify chỉ chờ một lệnh khoảng 26 giây) =====
const jobs = new Map(); // ponytail: lưu trong bộ nhớ, máy chủ khởi động lại thì mất việc đang chạy
function startParse(skill, { paths, text, keyPaths, keyText }) {
  const jid = randomBytes(8).toString('hex');
  for (const [k, j] of jobs) if (Date.now() - j.at > 3600e3) jobs.delete(k);
  jobs.set(jid, { status: 'running', at: Date.now() });
  const load = async list => { const out = []; for (const p of list) { const buf = await db.download(p); if (buf && mimeOf(p)) out.push(AI.filePart(p.split('/').pop(), mimeOf(p), buf)); } return out; };
  (async () => {
    const [test, key] = [await load(paths), await load(keyPaths)];
    if (!test.length && !text) throw new Error('Không đọc được file đề. Hãy tải lại file PDF hoặc ảnh.');
    return AI.parseTest(skill, { test, text, key, keyText });
  })().then(result => jobs.set(jid, { status: 'done', at: Date.now(), result }))
    .catch(e => { console.error('AI đọc đề lỗi', e); jobs.set(jid, { status: 'error', at: Date.now(), error: String(e.message || e) }); })
    .finally(() => db.removeFiles([...paths, ...keyPaths]));
  return jid;
}

// ===== HTTP =====
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpErr(code, msg); };
function readBody(req, limit) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { rej(new HttpErr(413, 'Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
const json = async req => { try { return JSON.parse((await readBody(req, 8e6)).toString() || '{}'); } catch (e) { throw e instanceof HttpErr ? e : new HttpErr(400, 'Dữ liệu không hợp lệ'); } };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const sid = req => /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
const fails = new Map(); // chống dò mật khẩu: 5 lần sai thì khóa 5 phút
const extOf = mime => ({ 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'image/jpeg': 'jpg' }[mime] || mime.split('/')[1].replace(/^x-/, '').replace(/[^a-z0-9]/g, '') || 'bin');
const cleanMime = m => (/^((audio|image)\/[\w.+-]+|application\/pdf)$/.exec(String(m || '').split(';')[0].trim()) || [''])[0];
const rid = () => randomBytes(12).toString('hex');

function serveMusic(req, res, name) {
  const type = AUDIO_TYPE[name.split('.').pop().toLowerCase()];
  if (!type || /[\\/]|^\./.test(name)) return send(res, 404, { error: 'Không tìm thấy' });
  let size; try { size = fs.statSync(new URL(encodeURIComponent(name), MUSIC_DIR)).size; } catch { return send(res, 404, { error: 'Không tìm thấy' }); }
  const file = new URL(encodeURIComponent(name), MUSIC_DIR), range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  if (!range) { res.writeHead(200, { ...head, 'Content-Length': size }); return fs.createReadStream(file).pipe(res); }
  const start = range[1] ? +range[1] : size - +range[2], end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
  if (start < 0 || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}
function serveMem(req, res, token) { // chỉ dùng ở chế độ bộ nhớ, có hỗ trợ tua (Range)
  const f = db.memFile.get(token);
  if (!f) return send(res, 404, { error: 'Không tìm thấy file' });
  const size = f.buf.length, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const head = { 'Content-Type': f.mime, 'Accept-Ranges': 'bytes' };
  if (!range) { res.writeHead(200, { ...head, 'Content-Length': size }); return res.end(f.buf); }
  const start = range[1] ? +range[1] : size - +range[2], end = range[1] && range[2] ? +range[2] : size - 1;
  if (start < 0 || start >= size || end >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  res.end(f.buf.subarray(start, end + 1));
}

const pubStudent = (s, l) => ({ username: s.username, name: s.name, avatar: s.avatar || null, bonus: s.bonus, parent_phone: s.parent_phone, mustChange: !!s.must_change, zero_at: s.zero_at, notify_status: s.notify_status, hearts: l.hearts, lates: l.lates.length });
async function visibleA(id) { const a = await db.getA(id); if (!a || !a.published) fail(404, 'Không tìm thấy bài tập'); return a; }
const newSub = (a, u) => ({ key: db.subKey(a.id, u), aid: a.id, skill: a.skill, student: u, status: 'draft', answers: {}, timeSec: 0, attempts: 0, startedAt: Date.now(), leaves: 0, pasted: 0, listens: 0 });
const cleanEssays = (a, w) => tasksOf(a).map((_, i) => { const html = String((w?.tasks || [])[i]?.html || ''); return { html, words: wordCount(textOf(html)) }; });
async function draftOf(a, u) { const s = (await db.getS(a.id, u)) || newSub(a, u); if (s.status === 'submitted') fail(409, 'Em đã nộp bài này rồi'); return s; }
function phoneOf(b) {
  const p = String(b.parent_phone || '').trim();
  if (p && !/^\+?[\d .-]{8,15}$/.test(p)) fail(400, 'Số điện thoại phụ huynh không hợp lệ');
  return p || null;
}
// nhân vật học sinh tự chọn: chỉ nhận đúng các lựa chọn có sẵn
const AV_ENUM = {
  gender: ['girl', 'boy'], hairStyle: ['long', 'bob', 'ponytail', 'bun', 'pigtails', 'curly', 'short', 'sidepart', 'spiky', 'buzz', 'curlyshort', 'quiff'],
  top: ['tee', 'blouse', 'polo', 'shirt', 'hoodie', 'sweater', 'jacket', 'dress', 'uniform'], bottom: ['pants', 'shorts', 'skirt'], shoes: ['school', 'sneaker', 'boot'],
  hat: ['none', 'beret', 'cap', 'beanie', 'crown', 'bow', 'headphones', 'conical'], glasses: ['none', 'regular', 'round', 'sun'], beard: ['none', 'mustache', 'full'],
};
const AV_COLOR_KEYS = { hair: '', skin: '', color: '', bottomColor: '#2f3a56', shoeColor: '#6b4423', hatColor: '#ef4b4b' }; // '' = bắt buộc
function cleanAvatar(v) {
  if (!v || typeof v !== 'object') fail(400, 'Nhân vật không hợp lệ');
  const a = {};
  for (const [k, list] of Object.entries(AV_ENUM)) a[k] = list.includes(v[k]) ? v[k] : list[0];
  for (const [k, def] of Object.entries(AV_COLOR_KEYS)) {
    if (v[k] == null && def) { a[k] = def; continue; }
    if (!/^#[0-9a-f]{6}$/i.test(v[k] || '')) fail(400, 'Màu không hợp lệ');
    a[k] = v[k].toLowerCase();
  }
  return a;
}

async function api(req, res, path) {
  const M = req.method, seg = path.split('/').slice(2), [r0, r1, r2] = seg;

  if (r0 === 'health') return send(res, 200, { ok: true, storage: db.mode });
  if (r0 === '_mem' && db.mode === 'memory') {
    if (M === 'PUT') return send(res, db.memFile.put(r1, cleanMime(req.headers['content-type']) || 'application/octet-stream', await readBody(req, 100e6)) ? 200 : 403, {});
    return serveMem(req, res, r1);
  }
  if (M === 'POST' && r0 === 'login') {
    const b = await json(req), u = String(b.username || '').trim().toLowerCase();
    const f = fails.get(u);
    if (f && f.n >= 5 && Date.now() - f.t < 300e3) fail(429, 'Sai mật khẩu nhiều lần. Đợi 5 phút rồi thử lại.');
    const row = await db.getUser(u);
    if (!row || !checkPw(b.password, row.pass)) { fails.set(u, { n: (f && Date.now() - f.t < 300e3 ? f.n : 0) + 1, t: Date.now() }); fail(401, 'Sai tên đăng nhập hoặc mật khẩu'); }
    fails.delete(u);
    if (row.role === 'student') await db.delSessionsOf(u); // mỗi học sinh chỉ đăng nhập trên 1 máy
    const t = randomBytes(32).toString('hex');
    await db.addSession(t, u);
    const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.HTTPS ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
    return send(res, 200, { ok: true });
  }
  const user = sid(req) ? await db.sessionUser(sid(req)) : null;
  if (!user) fail(401, 'Em cần đăng nhập lại');
  if (M === 'POST' && r0 === 'logout') { await db.delSession(sid(req)); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); return send(res, 200, { ok: true }); }
  if (M === 'POST' && r0 === 'password') {
    const b = await json(req), pw = String(b.new || ''), min = user.role === 'teacher' ? 6 : 4;
    if (!user.must_change && !checkPw(b.old, user.pass)) fail(400, 'Mật khẩu cũ không đúng');
    if (pw.length < min) fail(400, `Mật khẩu mới cần ít nhất ${min} ký tự`);
    if (pw === START_PW) fail(400, 'Hãy chọn mật khẩu khác "1"');
    await db.updateUser(user.username, { pass: hashPw(pw), must_change: false });
    return send(res, 200, { ok: true });
  }
  if (user.must_change && r0 !== 'me') fail(403, 'Em cần đổi mật khẩu trước khi làm bài');
  if (M === 'POST' && r0 === 'avatar') { await db.updateUser(user.username, { avatar: cleanAvatar((await json(req)).avatar) }); return send(res, 200, { ok: true }); }
  const meInfo = { username: user.username, name: user.name, role: user.role, avatar: user.avatar || null, mustChange: !!user.must_change };
  return user.role === 'student' ? studentApi(req, res, M, seg, user, meInfo) : teacherApi(req, res, M, seg, user, meInfo);
}

async function studentApi(req, res, M, [r0, r1, r2], user, meInfo) {
  const u = user.username;
  if (M === 'GET' && r0 === 'me') {
    checkLives();
    const [all, subs] = await Promise.all([db.allA(), db.subsWhere('username', u)]);
    const as = all.filter(a => a.published), by = Object.fromEntries(subs.map(s => [s.aid, s]));
    return send(res, 200, {
      me: meInfo, hearts: livesOf(user, as, subs).hearts, zeroAt: user.zero_at || null,
      assignments: await withUrls(as.map(a => forStudent(a, by[a.id])), mediaOf),
      subs: await withUrls(subs, recsOf),
    });
  }
  if (M === 'POST' && r0 === 'upload') { // xin link để tải file ghi âm Speaking lên kho
    const b = await json(req), a = await visibleA(b.aid), mime = cleanMime(b.type);
    await draftOf(a, u);
    if (a.skill !== 'speaking' || !(a.questions || []).some(x => x.id === b.qid)) fail(400, 'Câu hỏi không hợp lệ');
    if (!mime.startsWith('audio/')) fail(400, 'Chỉ nhận file ghi âm');
    const path = `rec/${u}/${a.id}/${b.qid}-${rid()}.${extOf(mime)}`;
    return send(res, 200, { path, url: await db.signUpload(path) });
  }
  const a = r1 && await visibleA(r1);
  if (M === 'POST' && r0 === 'beat') { // đồng hồ do máy chủ giữ: không cộng quá thời gian thực đã trôi qua
    const b = await json(req), s = (await db.getS(a.id, u)) || newSub(a, u);
    if (s.status !== 'submitted') {
      const now = Date.now(), cap = s.lastBeat ? (now - s.lastBeat) / 1000 + 2 : 30;
      s.timeSec = Math.round((s.timeSec || 0) + Math.max(0, Math.min(+b.sec || 0, cap))); s.lastBeat = now; await db.putS(s);
    }
    return send(res, 200, { timeSec: s.timeSec });
  }
  if (M === 'POST' && r0 === 'leave') { const s = await draftOf(a, u); s.leaves = (s.leaves || 0) + 1; await db.putS(s); return send(res, 200, { leaves: s.leaves }); }
  if (M === 'POST' && r0 === 'listen') { // mỗi bài nghe tối đa 2 lượt; nộp rồi thì nghe lại thoải mái
    if (a.skill !== 'listening' || !a.audio) fail(400, 'Bài này không có file nghe');
    const s = (await db.getS(a.id, u)) || newSub(a, u);
    if (s.status !== 'submitted') {
      if ((s.listens || 0) >= MAX_LISTENS) fail(403, `Em đã nghe đủ ${MAX_LISTENS} lần rồi`);
      s.listens = (s.listens || 0) + 1; await db.putS(s);
    }
    const urls = await db.signUrls([a.audio], 3 * 3600);
    return send(res, 200, { url: urls[a.audio], listens: s.listens });
  }
  if (M === 'POST' && r0 === 'draft') {
    const b = await json(req), s = await draftOf(a, u);
    if (b.answers && typeof b.answers === 'object') s.answers = b.answers;
    if (a.skill === 'writing' && b.writing) s.writing = { tasks: cleanEssays(a, b.writing) };
    s.pasted = Math.max(s.pasted || 0, +b.pasted || 0);
    await db.putS(s); return send(res, 200, { ok: true });
  }
  if (r0 === 'rec' && r2 && (M === 'POST' || M === 'DELETE')) { // mỗi câu Speaking là một file ghi âm riêng
    const s = await draftOf(a, u);
    if (a.skill !== 'speaking' || !(a.questions || []).some(x => x.id === r2)) fail(400, 'Câu hỏi không hợp lệ');
    s.speaking = s.speaking || { items: {} };
    const old = s.speaking.items[r2]?.path;
    delete s.speaking.items[r2];
    if (M === 'POST') {
      const b = await json(req);
      if (!String(b.path || '').startsWith(`rec/${u}/${a.id}/${r2}-`)) fail(400, 'File ghi âm không hợp lệ');
      s.speaking.items[r2] = { path: b.path, dur: Math.max(0, +b.dur || 0) };
    }
    await db.putS(s);
    if (old && old !== s.speaking.items[r2]?.path) await db.removeFiles([old]);
    const item = s.speaking.items[r2];
    return send(res, 200, { item: item ? { ...item, url: (await db.signUrls([item.path]))[item.path] } : null });
  }
  if (M === 'POST' && r0 === 'submit') {
    const b = await json(req), s = await draftOf(a, u);
    if (a.skill === 'reading' || a.skill === 'listening') {
      s.answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
      s.result = a.mode === 'dictation' ? gradeDictation(a.transcript, s.answers.dict) : gradeGroups(a.groups, s.answers);
    } else if (a.skill === 'writing') {
      const essays = cleanEssays(a, b.writing);
      if (!essays.some(e => e.words)) fail(400, 'Em chưa viết gì cả!');
      s.writing = { tasks: essays }; s.pasted = Math.max(s.pasted || 0, +b.pasted || 0);
      s.aiStatus = ai ? 'grading' : 'off';
    } else {
      const miss = (a.questions || []).filter(x => !s.speaking?.items?.[x.id]).length;
      if (miss) fail(400, `Em còn ${miss} câu chưa ghi âm`);
    }
    s.status = 'submitted'; s.submittedAt = Date.now(); s.attempts = (s.attempts || 0) + 1;
    await db.putS(s);
    if (a.skill === 'writing' && ai) aiGrade(a.id, u);
    const [as, subs] = await Promise.all([db.allA(), db.subsWhere('username', u)]);
    lastCheck = 0; checkLives();
    return send(res, 200, { sub: (await withUrls([s], recsOf))[0], assignment: (await withUrls([a], mediaOf))[0], hearts: livesOf(user, as, subs).hearts });
  }
  if (M === 'POST' && r0 === 'unsubmit') { // Speaking: được ghi lại nếu cô chưa chấm
    const s = await db.getS(a.id, u);
    if (a.skill !== 'speaking' || !s || s.status !== 'submitted' || s.feedback) fail(409, 'Không thể sửa bài này nữa');
    s.status = 'draft'; await db.putS(s); return send(res, 200, { ok: true });
  }
  fail(404, 'Không có chức năng này');
}

async function teacherApi(req, res, M, seg, user, meInfo) {
  const [r0, r1, r2] = seg;
  if (M === 'GET' && r0 === 'me') return send(res, 200, { me: meInfo });
  if (M === 'GET' && r0 === 'all') {
    await checkLives();
    const [as, subs, st] = await Promise.all([db.allA(), db.allSubs(), db.students()]);
    return send(res, 200, {
      me: meInfo, ai: !!ai,
      assignments: await withUrls(as, mediaOf), subs: await withUrls(subs, recsOf),
      students: st.map(s => pubStudent(s, livesOf(s, as, subs))),
    });
  }
  if (M === 'POST' && r0 === 'upload') { // xin link để tải audio / ảnh đề lên kho
    const b = await json(req), mime = cleanMime(b.type);
    if (!mime) fail(400, 'Chỉ nhận file âm thanh, hình ảnh hoặc PDF');
    const path = `media/${rid()}.${extOf(mime)}`;
    return send(res, 200, { path, url: await db.signUpload(path), view: (await db.signUrls([path]))[path] });
  }
  if (M === 'POST' && r0 === 'ai' && r1 === 'parse') { // cô tải đề (PDF/ảnh) hoặc dán chữ → AI dựng bài
    if (!ai) fail(400, 'Máy chủ chưa cấu hình OPENROUTER_API_KEY');
    const b = await json(req), files = list => (list || []).filter(p => /^media\/[a-f0-9]+\.(pdf|jpg|jpeg|png|webp|gif)$/.test(p)).slice(0, 30);
    if (!['reading', 'listening'].includes(b.skill)) fail(400, 'Chỉ dùng cho Reading và Listening');
    const job = startParse(b.skill, { paths: files(b.paths), text: String(b.text || '').slice(0, 200000), keyPaths: files(b.keyPaths), keyText: String(b.keyText || '').slice(0, 50000) });
    return send(res, 200, { job });
  }
  if (M === 'GET' && r0 === 'ai' && r1 === 'job') { const j = jobs.get(r2); if (!j) fail(404, 'Không tìm thấy việc này (máy chủ có thể vừa khởi động lại)'); return send(res, 200, j); }
  if (M === 'PUT' && r0 === 'assignment') {
    const a = await json(req); delete a._urls;
    if (!/^[\w-]{4,40}$/.test(a.id || '')) fail(400, 'Mã bài không hợp lệ');
    if (a.skill === 'speaking' && Array.isArray(a.questions)) a.questions.sort((x, y) => (+x.part || 1) - (+y.part || 1));
    const old = await db.getA(a.id);
    a.published = !!old?.published; a.publishedAt = old?.publishedAt;
    const p = problems(a);
    if (a.published && p.length) return send(res, 400, { error: 'Bài đã giao phải đầy đủ. Kiểm tra lại:', problems: p });
    await db.putA(a);
    if (old) await dropUnusedMedia(mediaOf(old));
    return send(res, 200, { ok: true, problems: p });
  }
  if (M === 'DELETE' && r0 === 'assignment') {
    const [a, subs] = await Promise.all([db.getA(r1), db.subsWhere('aid', r1)]);
    await db.delA(r1);
    await dropUnusedMedia(a ? mediaOf(a) : []);
    await db.removeFiles(subs.flatMap(recsOf));
    return send(res, 200, { ok: true });
  }
  if (M === 'POST' && r0 === 'publish') { // giao bài theo từng kỹ năng: chỉ cần bài của kỹ năng đó đầy đủ
    const { skill } = await json(req);
    if (!SKS.includes(skill)) fail(400, 'Kỹ năng không hợp lệ');
    const drafts = (await db.allA()).filter(a => a.skill === skill && !a.published), errs = drafts.flatMap(problems);
    if (!drafts.length) errs.push('Không có bài mới nào để giao.');
    if (errs.length) return send(res, 400, { error: 'Chưa giao được. Kiểm tra lại:', problems: errs });
    for (const a of drafts) { a.published = true; a.publishedAt = Date.now(); await db.putA(a); }
    return send(res, 200, { ok: true, n: drafts.length });
  }
  if (r0 === 'sub' && r1 && r2) {
    const s = await db.getS(r1, r2); if (!s) fail(404, 'Không tìm thấy bài nộp');
    if (M === 'POST' && seg[3] === 'feedback') {
      const b = await json(req), fb = b.feedback || {};
      if (Array.isArray(fb.tasks)) { const a = await db.getA(r1); if (a) fb.band = overallBand(tasksOf(a), fb.tasks.map(t => t.band)); }
      s.feedback = { ...fb, by: 'teacher', updatedAt: Date.now() }; if (s.aiStatus === 'grading') s.aiStatus = 'done';
      await db.putS(s); return send(res, 200, { ok: true });
    }
    if (M === 'POST' && seg[3] === 'regrade') {
      if (!ai) fail(400, 'Máy chủ chưa cấu hình AI');
      delete s.feedback; s.aiStatus = 'grading'; delete s.aiError; await db.putS(s); aiGrade(r1, r2);
      return send(res, 200, { ok: true });
    }
    if (M === 'DELETE') { await db.delS(s.key); await db.removeFiles(recsOf(s)); return send(res, 200, { ok: true }); }
  }
  if (r0 === 'students') {
    if (M === 'POST' && !r1) {
      const b = await json(req), u = String(b.username || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 40);
      if (!/^[a-z0-9._-]{3,30}$/.test(u)) fail(400, 'Tên đăng nhập 3–30 ký tự, chỉ gồm chữ không dấu, số, dấu . _ -');
      if (!name) fail(400, 'Hãy nhập họ tên học sinh');
      const parent_phone = phoneOf(b);
      if (await db.getUser(u)) fail(409, 'Tên đăng nhập này đã có');
      await db.insertUser({ username: u, name, role: 'student', pass: hashPw(START_PW), must_change: true, bonus: 0, created: Date.now(), parent_phone });
      return send(res, 200, { username: u, password: START_PW });
    }
    const st = r1 && await db.getUser(r1);
    if (!st || st.role !== 'student') fail(404, 'Không tìm thấy học sinh');
    if (M === 'PATCH' && !r2) {
      const b = await json(req), name = String(b.name || '').trim().slice(0, 40);
      if (!name) fail(400, 'Hãy nhập họ tên học sinh');
      await db.updateUser(r1, { name, parent_phone: phoneOf(b) }); return send(res, 200, { ok: true });
    }
    if (M === 'POST' && r2 === 'password') {
      const pw = String((await json(req)).password || '');
      if (pw && pw.length < 4) fail(400, 'Mật khẩu cần ít nhất 4 ký tự');
      await db.updateUser(r1, { pass: hashPw(pw || START_PW), must_change: !pw }); await db.delSessionsOf(r1);
      return send(res, 200, { username: r1, password: pw || START_PW });
    }
    if (M === 'POST' && r2 === 'restore') { // khôi phục đủ 3 mạng sau khi đã báo phụ huynh
      const [as, subs] = await Promise.all([db.allA(), db.subsWhere('username', r1)]);
      await db.updateUser(r1, { bonus: livesOf({ ...st, bonus: 0 }, as, subs).lates.length, zero_at: null, notify_status: null });
      return send(res, 200, { hearts: LIVES });
    }
    if (M === 'DELETE' && !r2) {
      const subs = await db.subsWhere('username', r1);
      await db.deleteUser(r1); await db.removeFiles(subs.flatMap(recsOf));
      return send(res, 200, { ok: true });
    }
  }
  fail(404, 'Không có chức năng này');
}

// giao diện: khi chạy thật thì Netlify phục vụ public/, ở máy cá nhân thì máy chủ phục vụ luôn
const INDEX = new URL('./public/index.html', import.meta.url);
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method === 'GET' && path === '/music/playlist.json') return send(res, 200, listMusic());
    if (req.method === 'GET' && path.startsWith('/music/')) return serveMusic(req, res, decodeURIComponent(path.slice(7)));
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(INDEX).pipe(res);
    }
    send(res, 404, { error: 'Không tìm thấy' });
  } catch (e) {
    if (!(e instanceof HttpErr)) console.error(e);
    if (!res.headersSent) send(res, e.code || 500, { error: e instanceof HttpErr ? e.message : 'Lỗi máy chủ' });
  }
}).on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n  Cổng ${PORT} đang bị chương trình khác dùng (có thể là một cửa sổ IELTS Quest khác đang chạy).\n  Tắt cửa sổ đó, hoặc chạy cổng khác:  PowerShell: $env:PORT=3001; npm run dev\n`);
  process.exit(1);
}).listen(PORT, async () => {
  const dev = process.argv.includes('--dev'); // npm run dev
  // tên đăng nhập luôn là chữ thường (lúc đăng nhập cũng đổi về chữ thường). Đặt TEACHER_USER mới thì tạo thêm tài khoản đó.
  const tu = String(process.env.TEACHER_USER || 'giaovien').trim().toLowerCase(), found = await db.getUser(tu);
  if (found && found.role !== 'teacher') console.error(`  TEACHER_USER "${tu}" đang là tài khoản học sinh, hãy chọn tên khác.`);
  else if (!found && (process.env.TEACHER_USER || !(await db.hasTeacher()))) {
    const pw = process.env.TEACHER_PASSWORD || (dev ? 'giaovien123' : genPw());
    await db.insertUser({ username: tu, name: 'Giáo viên', role: 'teacher', pass: hashPw(pw), bonus: 0, created: Date.now() });
    console.log(`\n  Tài khoản giáo viên: ${tu} / ${process.env.TEACHER_PASSWORD ? '(mật khẩu trong .env)' : pw}  (đổi mật khẩu trong mục CÀI ĐẶT)`);
  }
  if (dev && db.mode === 'memory') { // không bao giờ đổ dữ liệu mẫu vào Supabase thật
    await (await import('./dev-seed.js')).seed(hashPw);
    console.log('  Học sinh mẫu: hocsinh / 123456 (đã có sẵn 1 bài cho mỗi kỹ năng)\n');
  }
  {
    const n = listMusic().length;
    console.log(n ? `  Nhạc nền: ${n} bài trong public/music` : '  Nhạc nền: chưa có bài nào (chép file mp3 vào thư mục public/music)');
  }
  if (db.mode === 'memory') console.log('  Chưa có SUPABASE_URL: đang chạy bằng bộ nhớ tạm, tắt máy chủ là mất dữ liệu.');
  if (!ai) console.log('  Chưa có OPENROUTER_API_KEY: AI đọc đề và AI chấm Writing đang tắt.');
  console.log(`  IELTS Quest đang chạy: http://localhost:${PORT}`);
});
