// Kiểm tra luồng chính trên máy chủ thật (chế độ bộ nhớ tạm, không cần Supabase): npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://localhost:${PORT}`;
// OpenRouter giả: trả kết quả cố định, ghi lại yêu cầu để kiểm tra
const seen = [];
const AI_TEST = {
  title: 'Cambridge Test 1', answers_from_key: true, notes: '',
  passages: [{ title: 'Tea', html: '<p>A Tea...</p>' }, { title: 'Coffee', html: '<p>B Coffee...</p>' }],
  groups: [
    { section: 1, preset: 'mcq', instructions: 'Choose', list_title: '', options: [], roman: false, content_html: '', max_words: 0, bank: [], needs_image: false,
      items: [{ text: 'Q1', options: ['a', 'b', 'c', 'd'], choose: 0, answer: 'C' }] },
    { section: 2, preset: 'headings', instructions: 'Headings', list_title: 'List of Headings', options: ['H1', 'H2', 'H3', 'H4'], roman: true, content_html: '', max_words: 0, bank: [], needs_image: false,
      items: [{ text: 'Paragraph A', options: [], choose: 0, answer: 'iii' }] },
    { section: 2, preset: 'notes', instructions: 'Notes', list_title: '', options: [], roman: false, content_html: '<p>Name: ___ and ___</p>', max_words: 2, bank: [], needs_image: false,
      items: [{ text: '', options: [], choose: 0, answer: 'Smith' }] },
    { section: 2, preset: 'multi', instructions: 'Choose TWO', list_title: '', options: [], roman: false, content_html: '', max_words: 0, bank: [], needs_image: false,
      items: [{ text: 'Which TWO?', options: ['a', 'b', 'c', 'd', 'e'], choose: 2, answer: 'B, E' }] },
  ],
};
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d; }).on('end', () => {
    const body = JSON.parse(b); seen.push(body);
    if (body.model.endsWith(':free') && body.response_format.type === 'json_schema') { // giả nhà cung cấp chỉ nhận json_object (như Novita)
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ message: "does not support 'json_schema' response format. Supported formats: json_object." }) } } }));
    }
    if (body.model.endsWith(':free') && body.messages[1].content.some(c => c.type === 'image_url')) { // giả model chỉ đọc chữ
      res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'No endpoints found that support image input' } }));
    }
    const parse = JSON.stringify(body).includes('passages');
    const out = parse ? AI_TEST : { band: 6.3, comment_html: '<p>Tốt</p>', annotated_html: '<p>Hello</p>' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(out) } }] }));
  });
});
let srv;
before(async () => {
  await new Promise(r => fake.listen(0, r));
  const env = { ...process.env, PORT: String(PORT), TEACHER_USER: 'co', TEACHER_PASSWORD: 'secret123', OPENROUTER_API_KEY: 'test', OPENROUTER_WRITING_MODEL: 'apodex/apodex-1.1-mini:free', OPENROUTER_PDF_ENGINE: 'cloudflare-ai', OPENROUTER_BASE_URL: `http://localhost:${fake.address().port}` };
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'MAIL_FROM']) delete env[k];
  srv = spawn(process.execPath, ['server.js'], { env, stdio: 'pipe' });
  await new Promise((res, rej) => { srv.stdout.on('data', d => /đang chạy/.test(d) && res()); srv.on('exit', rej); });
});
after(async () => { srv.kill(); await new Promise(r => srv.on('exit', r)); fake.close(); });

function client() {
  let cookie = '';
  return async (path, body, method) => {
    const headers = { cookie };
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await fetch(BASE + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
// tải file lên bằng link ký tạm, như trình duyệt làm
async function upload(C, meta, bytes, type) {
  const r = (await C('/api/upload', { ...meta, type })).data;
  const put = await fetch(new URL(r.url, BASE), { method: 'PUT', headers: { 'content-type': type }, body: bytes });
  assert.equal(put.status, 200);
  return r.path;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('luồng giáo viên → học sinh', async () => {
  const T = client(), H = client();
  assert.equal((await T('/api/login', { username: 'co', password: 'sai' })).status, 401);
  assert.equal((await T('/api/login', { username: 'co', password: 'secret123' })).status, 200);

  // cấp tài khoản kèm liên hệ phụ huynh
  assert.equal((await T('/api/students', { name: 'X', username: 'xx1', parent_phone: 'goi me' })).status, 400);
  const acc = (await T('/api/students', { name: 'Hoàng Thơ', username: 'hoangtho', parent_phone: '0901234567', parent_email: 'bo@qua.vn' })).data;
  assert.equal(acc.password, '1'); // mật khẩu ban đầu
  assert.equal((await T('/api/students', { name: 'X', username: 'hoangtho' })).status, 409);

  const audio = await upload(T, {}, new Uint8Array(1000).fill(7), 'audio/mpeg');
  assert.match(audio, /^media\/[a-f0-9]+\.mp3$/);
  const future = Date.now() + 864e5, soon = Date.now() + 2500;

  // Reading theo nhóm câu IELTS
  const R = { id: 'read1', skill: 'reading', title: 'R1', deadline: future, passage: '<p>Text</p>', groups: [
    { id: 'g1', type: 'mcq', items: [{ id: 'm1', text: 'Q', options: ['a', 'b', 'c', 'd'], answer: 1 }] },
    { id: 'g2', type: 'multi', items: [{ id: 'mu', text: 'Choose TWO', options: ['a', 'b', 'c', 'd', 'e'], choose: 2, answer: [0, 3] }] },
    { id: 'g3', type: 'tfng', items: [{ id: 't1', text: 'S', answer: 'TRUE' }] },
    { id: 'g4', type: 'match', labels: 'roman', options: ['H1', 'H2', 'H3'], items: [{ id: 'h1', text: 'Paragraph A', answer: 2 }] },
    { id: 'g5', type: 'gap', maxWords: 2, html: '<p>Opens at ___ and closes at ___.</p>', items: [{ id: 'f1', answer: 'nine | 9' }, { id: 'f2', answer: 'five pm' }] },
    { id: 'g6', type: 'gap', bank: ['cat', 'dog'], html: '<p>A ___ barks.</p>', items: [{ id: 'b1', answer: 1 }] }] };
  await T('/api/assignment', R, 'PUT');
  // giao theo từng kỹ năng: Reading đủ bài là giao được, không cần chờ kỹ năng khác
  let pub = await T('/api/publish', { skill: 'reading' });
  assert.equal(pub.status, 200, JSON.stringify(pub.data)); assert.equal(pub.data.n, 1);
  assert.equal((await T('/api/publish', { skill: 'reading' })).status, 400); // không còn bài mới

  const L = { id: 'list1', skill: 'listening', title: 'L1', deadline: future, mode: 'questions', audio,
    groups: [{ id: 'lg', type: 'gap', html: '<p>Name: ___</p>', items: [{ id: 'n1', answer: 'Smith' }] }] };
  const D = { id: 'dict1', skill: 'listening', title: 'D1', deadline: soon, mode: 'dictation', audio, transcript: 'The library opens at nine.\nBring your card.' };
  const W = { id: 'writ1', skill: 'writing', title: 'W1', deadline: soon, tasks: [
    { no: 1, prompt: '<p>Describe the chart</p>', minWords: 150, images: ['data:image/png;base64,iVBORw0KGgo='] },
    { no: 2, prompt: '<p>Discuss both views</p>', minWords: 250, images: [] }] };
  const S = { id: 'spk1', skill: 'speaking', title: 'S1', deadline: soon, questions: [{ id: 'a', text: 'Hi?' }, { id: 'b', text: 'Why?' }] };
  for (const a of [L, D, W, S]) assert.equal((await T('/api/assignment', a, 'PUT')).status, 200);
  // bài đã giao mà sửa thiếu → không lưu được
  assert.equal((await T('/api/assignment', { ...R, groups: [{ id: 'g', type: 'gap', html: '<p>___ ___</p>', items: [{ id: 'z', answer: 'x' }] }] }, 'PUT')).status, 400);
  // bài nháp thiếu → kỹ năng đó chưa giao được (kỹ năng khác vẫn giao bình thường)
  const BAD = { ...L, id: 'list-bad', groups: [{ id: 'g', type: 'gap', html: '<p>___ ___</p>', items: [{ id: 'z', answer: 'x' }] }] };
  await T('/api/assignment', BAD, 'PUT');
  pub = await T('/api/publish', { skill: 'listening' });
  assert.equal(pub.status, 400); assert.ok(pub.data.problems.some(p => p.includes('không khớp')));
  assert.equal((await T('/api/assignment/list-bad', undefined, 'DELETE')).status, 200);
  for (const [k, n] of [['listening', 2], ['writing', 1], ['speaking', 1]]) {
    pub = await T('/api/publish', { skill: k });
    assert.equal(pub.status, 200, JSON.stringify(pub.data)); assert.equal(pub.data.n, n);
  }

  // học sinh: không thấy đáp án, transcript hay link audio
  assert.equal((await H('/api/login', { username: 'hoangtho', password: '1' })).status, 200);
  // lần đầu: phải đổi mật khẩu, chưa đổi thì máy chủ chặn mọi việc khác
  assert.equal((await H('/api/me')).data.me.mustChange, true);
  assert.equal((await H('/api/beat/read1', { sec: 1 })).status, 403);
  assert.equal((await H('/api/password', { new: '1' })).status, 400);
  assert.equal((await H('/api/password', { new: 'abc' })).status, 400);
  assert.equal((await H('/api/password', { new: 'meomeo' })).status, 200);
  let pw = 'meomeo';
  assert.equal((await H('/api/password', { old: 'sai', new: 'meomeo2' })).status, 400); // đổi lần sau phải đúng mật khẩu cũ
  // nhân vật tự chọn
  assert.equal((await H('/api/avatar', { avatar: { gender: 'boy', hair: 'red', skin: '#ffd7b5', color: '#2fb344' } })).status, 400);
  assert.equal((await H('/api/avatar', { avatar: { gender: 'boy', hairStyle: 'spiky', hair: '#5B3A1A', skin: '#ffd7b5', top: 'hoodie', color: '#2fb344', shoes: 'boot', shoeColor: '#1d1a2f', hat: 'crown', glasses: 'laser', x: 'y' } })).status, 200);
  const me = (await H('/api/me')).data;
  assert.deepEqual(me.me.avatar, { gender: 'boy', hairStyle: 'spiky', top: 'hoodie', bottom: 'pants', shoes: 'boot', hat: 'crown', glasses: 'none', beard: 'none',
    hair: '#5b3a1a', skin: '#ffd7b5', color: '#2fb344', bottomColor: '#2f3a56', shoeColor: '#1d1a2f', hatColor: '#ef4b4b', eyeColor: '#6a5aa8' }); // lựa chọn lạ ("laser") bị bỏ
  assert.equal(me.assignments.length, 5); assert.equal(me.hearts, 3);
  const r1 = me.assignments.find(a => a.id === 'read1');
  assert.ok(r1.groups.every(g => g.items.every(it => !('answer' in it))));
  const l1 = me.assignments.find(a => a.id === 'list1');
  assert.equal(l1.audio, undefined); assert.equal(l1.hasAudio, true);
  assert.deepEqual(me.assignments.find(a => a.id === 'dict1').lineWords, [5, 3]);
  assert.equal((await H('/api/all')).status, 404); // học sinh không vào được API giáo viên
  assert.equal((await H('/api/upload', { type: 'audio/mpeg' })).status, 404); // học sinh không tải audio đề lên được

  // nghe tối đa 2 lần
  const l = (await H('/api/listen/list1', {})).data;
  assert.equal(l.listens, 1);
  assert.equal((await fetch(new URL(l.url, BASE))).status, 200);
  assert.equal((await H('/api/listen/list1', {})).data.listens, 2);
  assert.equal((await H('/api/listen/list1', {})).status, 403);

  // đồng hồ không cộng quá thời gian thật
  assert.ok((await H('/api/beat/read1', { sec: 9999 })).data.timeSec <= 30);

  // Reading: chấm trên máy chủ theo điểm IELTS, chỉ nộp 1 lần
  await H('/api/leave/read1', {});
  const sub = (await H('/api/submit/read1', { answers: { m1: 1, mu: [0, 2], t1: 'FALSE', h1: 2, f1: ' Nine. ', f2: 'at five pm', b1: '1' } })).data;
  assert.equal(sub.sub.result.total, 8); // multi "Choose TWO" tính 2 điểm
  assert.equal(sub.sub.result.score, 5);
  assert.deepEqual(sub.sub.result.marks.mu, [1, 2]);
  assert.deepEqual(sub.sub.result.marks.f2, [0, 1]); // quá 2 từ là sai
  assert.equal(sub.sub.leaves, 1);
  assert.equal(sub.assignment.groups[0].items[0].answer, 1); // nộp rồi mới thấy đáp án
  assert.equal((await H('/api/submit/read1', { answers: {} })).status, 409);

  // Speaking: mỗi câu một file, tải thẳng lên kho
  const recPath = await upload(H, { aid: 'spk1', qid: 'a' }, new Uint8Array(5000).fill(1), 'audio/webm');
  assert.match(recPath, /^rec\/hoangtho\/spk1\/a-/);
  assert.equal((await H('/api/rec/spk1/a', { path: 'media/x.mp3', dur: 20 })).status, 400); // không được trỏ tới file người khác
  const item = (await H('/api/rec/spk1/a', { path: recPath, dur: 20.5 })).data.item;
  assert.equal(item.dur, 20.5);
  assert.equal((await fetch(new URL(item.url, BASE))).headers.get('content-type'), 'audio/webm');
  assert.equal((await H('/api/submit/spk1', {})).status, 400);
  const p2 = await upload(H, { aid: 'spk1', qid: 'b' }, new Uint8Array(10).fill(1), 'audio/webm');
  await H('/api/rec/spk1/b', { path: p2, dur: 10 });

  // trễ 3 bài (Speaking, Writing nộp trễ; Dictation quá hạn chưa nộp) → hết mạng → báo phụ huynh
  await sleep(Math.max(0, soon - Date.now()) + 200);
  assert.equal((await H('/api/submit/spk1', {})).data.hearts, 0); // cả 3 bài đều đã quá hạn
  const w = (await H('/api/submit/writ1', { writing: { tasks: [{ html: '<p>Hello <b>world</b> here</p>' }, { html: '<p>Task two essay</p>' }] }, pasted: 40 })).data;
  assert.deepEqual(w.sub.writing.tasks.map(t => t.words), [3, 3]); assert.equal(w.sub.aiStatus, 'grading'); assert.equal(w.hearts, 0);
  let all;
  for (let i = 0; i < 50; i++) { all = (await T('/api/all')).data; if (all.subs.find(x => x.aid === 'writ1')?.aiStatus !== 'grading') break; await sleep(100); } // chờ AI (giả) chấm xong 2 task
  const st = all.students.find(s => s.username === 'hoangtho');
  assert.equal(st.hearts, 0); assert.equal(st.lates, 3); assert.ok(st.zero_at);
  assert.match(st.notify_status, /0901234567/); // chưa cấu hình email → nhắc cô gọi điện
  assert.equal(all.subs.find(s => s.aid === 'read1').leaves, 1);
  const wfb = all.subs.find(s => s.aid === 'writ1');
  assert.equal(wfb.aiStatus, 'done', wfb.aiError); assert.equal(wfb.feedback.band, '6.5'); assert.equal(wfb.feedback.by, 'ai'); // band làm tròn 0.5
  // model chỉ đọc chữ: lần 1 kèm ảnh bị từ chối, lần 2 gửi lại không kèm ảnh
  const wr = seen.filter(b => b.model === 'apodex/apodex-1.1-mini:free');
  // json_schema bị từ chối → gửi lại bằng json_object kèm khuôn JSON; kèm ảnh bị từ chối → gửi lại không ảnh
  assert.deepEqual(wr.map(b => b.response_format.type), ['json_schema', 'json_object', 'json_object', 'json_object']); // Task 1 (3 lần) rồi Task 2
  assert.match(wr[3].messages[1].content[0].text, /Writing Task 2/);
  assert.equal(wfb.feedback.tasks.length, 2);
  assert.match(wr[1].messages[0].content, /exactly matching this JSON Schema/);
  assert.ok(!wr[2].messages[1].content.some(c => c.type === 'image_url'));
  assert.match(wr[2].messages[1].content[0].text, /could not be shown/);

  assert.equal((await T('/api/sub/writ1/hoangtho/feedback', { feedback: { tasks: [{ band: '5' }, { band: '7' }] } })).status, 200);
  assert.equal((await T('/api/all')).data.subs.find(s => s.aid === 'writ1').feedback.band, '6.5'); // (5 + 7×2) / 3 = 6.33 → 6.5
  // cô khôi phục 3 mạng
  assert.equal((await T('/api/students/hoangtho/restore', {})).data.hearts, 3);
  assert.equal((await H('/api/me')).data.hearts, 3);
  all = (await T('/api/all')).data;
  assert.equal(all.students[0].zero_at, null);

  // cô chấm Speaking → học sinh không sửa được nữa
  assert.equal((await T('/api/sub/spk1/hoangtho/feedback', { feedback: { band: '6.5', items: {} } })).status, 200);
  assert.equal((await H('/api/unsubmit/spk1', {})).status, 409);

  // đăng nhập máy khác → phiên cũ bị đăng xuất
  const H2 = client();
  // cô đổi mật khẩu cho học sinh (cài đặt), hoặc đặt lại về 1
  assert.equal((await T('/api/students/hoangtho/password', { password: 'xy' })).status, 400);
  assert.equal((await T('/api/students/hoangtho/password', { password: 'sach2026' })).data.password, 'sach2026');
  pw = 'sach2026';
  assert.equal((await H2('/api/login', { username: 'hoangtho', password: 'meomeo' })).status, 401);
  await H2('/api/login', { username: 'hoangtho', password: pw });
  assert.equal((await H2('/api/me')).data.me.mustChange, false);
  assert.equal((await H('/api/me')).status, 401);
});

test('AI đọc đề (OpenRouter giả)', async () => {
  const T = client();
  await T('/api/login', { username: 'co', password: 'secret123' });
  const pdf = await upload(T, {}, new TextEncoder().encode('%PDF-1.4 fake'), 'application/pdf');
  assert.match(pdf, /\.pdf$/);
  const keyPdf = await upload(T, {}, new TextEncoder().encode('%PDF-1.4 key'), 'application/pdf');
  const { job } = (await T('/api/ai/parse', { skill: 'reading', paths: [pdf, 'rec/x/y.webm'], text: '', keyPaths: [keyPdf], keyText: '1 C' })).data;
  let j;
  for (let i = 0; i < 50; i++) { j = (await T('/api/ai/job/' + job)).data; if (j.status !== 'running') break; await sleep(100); }
  assert.equal(j.status, 'done', j.error);
  const r = j.result;
  assert.equal(r.passages.length, 2); assert.match(r.passages[0], /<h3>Tea<\/h3>/);
  assert.equal(r.groups[0].items[0].answer, 2);                 // "C" → 2
  assert.equal(r.groups[1].labels, 'roman'); assert.equal(r.groups[1].items[0].answer, 2); // "iii" → 2
  assert.equal(r.groups[2].items.length, 2);                    // 2 chỗ ___ → 2 câu
  assert.deepEqual(r.groups[3].items[0].answer, [1, 4]);        // "B, E"
  assert.equal(r.total, 6);
  assert.ok(r.warnings.some(w => w.includes('___')) && r.warnings.some(w => w.includes('chưa có đáp án')));
  // gửi PDF đúng dạng file của OpenRouter, không gửi file ngoài thư mục đề
  const req = seen.find(b => b.response_format.type === 'json_schema' && b.response_format.json_schema.schema.properties.passages);
  const files = req.messages[1].content.filter(c => c.type === 'file');
  assert.equal(files.length, 2); assert.match(files[0].file.file_data, /^data:application\/pdf;base64,/);
  // đáp án nằm sau dòng đánh dấu riêng, đề nằm trước
  const parts = req.messages[1].content, keyAt = parts.findIndex(c => c.type === 'text' && c.text.startsWith('=== ANSWER KEY'));
  assert.ok(keyAt > parts.indexOf(files[0]) && parts.indexOf(files[1]) > keyAt);
  assert.match(parts[keyAt].text, /1 C/);
  assert.equal(req.provider.require_parameters, true);
  assert.deepEqual(req.plugins, [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }]); // chuyển PDF → chữ miễn phí
  // học sinh không dùng được
  const H = client();
  assert.equal((await H('/api/ai/parse', { skill: 'reading' })).status, 401);
});

test('nhạc nền + chỉ lưu SĐT phụ huynh + đặt lại mật khẩu', async () => {
  const T = client();
  await T('/api/login', { username: 'co', password: 'secret123' });
  assert.ok(Array.isArray((await client()('/music/playlist.json')).data));
  assert.equal((await fetch(BASE + '/music/..%2Fserver.js')).status, 404); // không lộ file ngoài thư mục nhạc
  const st = (await T('/api/all')).data.students.find(s => s.username === 'hoangtho');
  assert.equal(st.parent_phone, '0901234567'); assert.equal(st.parent_email, undefined);
  await T('/api/students/hoangtho/password', {});
  assert.equal((await T('/api/all')).data.students.find(s => s.username === 'hoangtho').mustChange, true);
  const H = client();
  assert.equal((await H('/api/login', { username: 'hoangtho', password: '1' })).status, 200);
  assert.equal((await H('/api/me')).data.me.mustChange, true);
});

test('chia lớp: bài chọn lớp chỉ học sinh trong lớp thấy', async () => {
  const T = client(), A = client(), B = client();
  await T('/api/login', { username: 'co', password: 'secret123' });
  for (const u of ['lopa1', 'lopb1']) await T('/api/students', { name: u, username: u });
  const c = (await T('/api/classes', { name: 'Lớp A' })).data;
  assert.equal((await T('/api/classes/' + c.id + '/members', { usernames: ['lopa1'] }, 'PUT')).status, 200);
  const S = { id: 'cls-spk', skill: 'speaking', title: 'Chỉ lớp A', deadline: Date.now() + 864e5, classes: [c.id, 'khong-co'], questions: [{ id: 'q', text: 'Hi?' }] };
  await T('/api/assignment', S, 'PUT'); await T('/api/publish', { skill: 'speaking' });
  const all = (await T('/api/all')).data;
  assert.deepEqual(all.assignments.find(a => a.id === S.id).classes, [c.id]); // bỏ mã lớp không tồn tại
  assert.deepEqual(all.students.find(s => s.username === 'lopa1').classes, [c.id]);
  await A('/api/login', { username: 'lopa1', password: '1' }); await B('/api/login', { username: 'lopb1', password: '1' });
  assert.ok((await A('/api/me')).data.assignments.some(a => a.id === S.id));
  assert.ok(!(await B('/api/me')).data.assignments.some(a => a.id === S.id));
  assert.equal((await T('/api/classes/' + c.id, undefined, 'DELETE')).status, 409); // lớp còn bài thì không xóa được
  await T('/api/assignment/' + S.id, undefined, 'DELETE');
  assert.equal((await T('/api/classes/' + c.id, undefined, 'DELETE')).status, 200);
  assert.deepEqual((await T('/api/all')).data.students.find(s => s.username === 'lopa1').classes, []);
});
