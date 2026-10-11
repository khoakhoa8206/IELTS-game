// AI qua OpenRouter: đọc đề IELTS (PDF / ảnh / chữ dán) thành bài tập, và chấm Writing.
// Đổi model bằng biến môi trường; xem giá ở https://openrouter.ai/models
import { randomBytes } from 'node:crypto';

const KEY = process.env.OPENROUTER_API_KEY;
export const enabled = !!KEY;
export const MODEL_PARSE = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
export const MODEL_WRITING = process.env.OPENROUTER_WRITING_MODEL || 'google/gemini-3.8-flash';
// model chỉ đọc chữ (vd. các model :free): OpenRouter chuyển PDF thành chữ. 'cloudflare-ai' miễn phí; để trống thì OpenRouter
// tự chọn (model đọc được PDF thì đọc thẳng, không thì dùng OCR 'mistral-ocr' tính phí ~2 USD/1000 trang)
const PDF_ENGINE = process.env.OPENROUTER_PDF_ENGINE || '';
const isImageErr = e => /image|modalit|vision/i.test(e.message);

// nhiều model (nhất là bản :free) chỉ nhận json_object, không nhận json_schema → nhớ lại để lần sau gửi thẳng kiểu đó
const jsonObjectOnly = new Set();
async function call({ model, system, content, schema, maxTokens }) {
  const loose = jsonObjectOnly.has(model);
  const r = await fetch((process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1') + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'IELTS Quest' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: loose ? `${system}\n\nReply with ONE JSON object only (no markdown), exactly matching this JSON Schema:\n${JSON.stringify(schema)}` : system }, { role: 'user', content }],
      response_format: loose ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
      provider: { require_parameters: true }, // chỉ dùng nhà cung cấp hỗ trợ kiểu trả JSON đã chọn
      ...(PDF_ENGINE && content.some(c => c.type === 'file') ? { plugins: [{ id: 'file-parser', pdf: { engine: PDF_ENGINE } }] } : {}),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    let why = d.error?.message || 'lỗi không rõ';
    try { why = JSON.parse(d.error.metadata.raw).message || why; } catch { /* không có chi tiết từ nhà cung cấp */ }
    if (!loose && /json_schema|response.?format|structured/i.test(why)) { jsonObjectOnly.add(model); return call({ model, system, content, schema, maxTokens }); }
    throw new Error(`OpenRouter ${r.status}: ${why}`);
  }
  const ch = d.choices?.[0];
  if (ch?.finish_reason === 'length') throw new Error('AI trả lời bị cắt giữa chừng (đề quá dài). Hãy chia đề thành nhiều lần nhập.');
  const txt = String(ch?.message?.content || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(txt); } catch { throw new Error('AI trả về dữ liệu không đọc được, hãy thử lại.'); }
}
// file trong kho → phần nội dung gửi cho AI
export function filePart(name, mime, buf) {
  const url = `data:${mime};base64,${buf.toString('base64')}`;
  return mime === 'application/pdf' ? { type: 'file', file: { filename: name, file_data: url } } : { type: 'image_url', image_url: { url } };
}

// ===== đọc đề =====
export const PRESET_TYPE = { mcq: 'mcq', multi: 'multi', tfng: 'tfng', ynng: 'ynng', headings: 'match', info: 'match', features: 'match', endings: 'match', map: 'match', notes: 'gap', sentence: 'gap', bank: 'gap', diagram: 'gap', short: 'gap' };
const str = { type: 'string' }, strs = { type: 'array', items: str }, int = { type: 'integer' }, bool = { type: 'boolean' };
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const PARSE_SCHEMA = obj({
  title: str,
  passages: { type: 'array', items: obj({ title: str, html: str }) },
  groups: { type: 'array', items: obj({
    section: int, preset: { type: 'string', enum: Object.keys(PRESET_TYPE) }, instructions: str,
    list_title: str, options: strs, roman: bool, content_html: str, max_words: int, bank: strs, needs_image: bool,
    items: { type: 'array', items: obj({ text: str, options: strs, choose: int, answer: str }) },
  }) },
  answers_from_key: bool,
  notes: str,
});
const PARSE_SYSTEM = `You convert IELTS test papers (PDF pages, photos or pasted text) into JSON for a practice website used by a teacher.

Copy passages and questions EXACTLY as printed. Do not invent, shorten, paraphrase or skip anything. Keep the original order. Leave out printed question numbers from items[].text, and leave out test-paper headers such as "READING PASSAGE 1" or "You should spend about 20 minutes on..." from passages (the website adds its own). A full Reading test has 3 passages and 40 questions; a Listening test has 3 or 4 sections. Recognise the structure and every question type yourself and reproduce the test in its original format. Convert whatever the document contains.

Reading: put each passage in passages[] as clean HTML (<p>, <b>, <i>, <ul>, <table>), keeping paragraph letters (A, B, C...) where printed. section = passage number (1, 2, 3).
Listening: passages = []. section = the section / part number exactly as printed (some tests have 3 sections, others 4).

Make one group per run of consecutive questions that share one instruction. Copy the instruction into instructions (keep line breaks). Choose preset:
- mcq: choose ONE letter. items[].text = question, items[].options = option texts without their letters, answer = the letter, e.g. "B".
- multi: choose TWO or THREE letters for one question. ONE item with choose = 2 or 3 (it covers that many question numbers), options without letters, answer = letters like "A,D".
- tfng / ynng: items[].text = the statement, answer = TRUE / FALSE / NOT GIVEN (or YES / NO / NOT GIVEN).
- headings: options = the headings without their roman numerals, roman = true, list_title = "List of Headings", items[].text = e.g. "Paragraph B", answer = roman numeral like "iv".
- info: "which paragraph contains...". options = one empty string per paragraph letter (6 paragraphs A–F → 6 empty strings), items[].text = the statement, answer = the letter.
- features / endings: options = the list texts without letters, list_title = the list heading if any, items[].text = the statement or sentence beginning, answer = the letter.
- map: plan / map / diagram labelling with letters. options = one empty string per letter on the picture, items[].text = the place name, answer = the letter, needs_image = true.
- notes / sentence / short / diagram: completion and short answers. content_html = the notes, form, table, flow-chart, sentences or questions as HTML, with every answer gap replaced by exactly ___ (three underscores) in question order and the printed question numbers removed. items: one per gap in the same order with text = "" and answer = the answer (alternatives separated by " | "). max_words from the instruction (ONE WORD ONLY → 1, NO MORE THAN TWO WORDS → 2, NO MORE THAN THREE WORDS AND/OR A NUMBER → 3; 0 if not stated). diagram also sets needs_image = true.
- bank: summary completion from a box of words. Like notes, but bank = the words without their letters and answer = the letter of the correct word.
For every field that does not apply use "", [], 0 or false.

Answers: the answer key may be inside the test paper or given separately after the line "=== ANSWER KEY ===". If there is an answer key, copy every answer from it, matching by question number, and set answers_from_key = true; if the key and the questions do not line up (missing numbers, different count), still use the key where it matches and explain the mismatch in notes. Otherwise, for Reading, solve every question carefully from the passage and set answers_from_key = false. For Listening without an answer key you cannot hear the audio: leave answer = "".

notes: a short note in Vietnamese for the teacher about anything to check: missing or unreadable pages, pictures the teacher must upload, answers you were unsure about.`;

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];
const id = () => randomBytes(5).toString('hex');
const letter = s => { const t = String(s || '').trim().toUpperCase(); return /^[A-Z]$/.test(t) ? t.charCodeAt(0) - 65 : null; };
const gaps = html => (String(html || '').match(/_{3,}/g) || []).length;
const TF = { T: 'TRUE', F: 'FALSE', Y: 'YES', N: 'NO', NG: 'NOT GIVEN' }; // đáp án viết tắt trong key
const tf = s => { let t = String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); t = TF[t] || t; return ['TRUE', 'FALSE', 'YES', 'NO', 'NOT GIVEN'].includes(t) ? t : null; };

// kết quả của AI → nhóm câu của web; ghi lại những chỗ cô cần kiểm tra
export function fromAI(out, skill) {
  const warn = [];
  const passages = skill === 'reading' ? (out.passages || []).map(p => (p.title ? `<h3>${p.title}</h3>` : '') + (p.html || '')) : [];
  const maxSec = skill === 'reading' ? Math.max(1, passages.length) : 4;
  let n = 1;
  const groups = (out.groups || []).filter(g => PRESET_TYPE[g.preset]).map(g => {
    const type = PRESET_TYPE[g.preset];
    const G = { id: id(), preset: g.preset, type, instructions: g.instructions || '', section: Math.max(1, Math.min(maxSec, g.section || 1)), items: [] };
    if (g.needs_image || g.preset === 'map' || g.preset === 'diagram') G.image = '';
    if (type === 'match') { G.labels = g.roman || g.preset === 'headings' ? 'roman' : 'letter'; G.title = g.list_title || ''; G.options = g.options || []; }
    if (type === 'gap') { G.html = g.content_html || ''; G.maxWords = g.max_words || 0; G.bank = g.preset === 'bank' ? g.bank || [] : []; }
    for (const it of g.items || []) {
      const o = { id: id(), text: String(it.text || '').replace(/^\s*\d{1,2}[.):]?\s+/, '') }; // bỏ số câu in sẵn
      if (type === 'mcq') { o.options = it.options || []; o.answer = letter(it.answer); }
      else if (type === 'multi') { o.options = it.options || []; o.choose = it.choose === 3 ? 3 : 2; o.answer = String(it.answer || '').split(/[^A-Za-z]+/).map(letter).filter(x => x !== null).sort((a, b) => a - b); }
      else if (type === 'tfng' || type === 'ynng') o.answer = tf(it.answer);
      else if (type === 'match') { const k = G.labels === 'roman' ? ROMAN.indexOf(String(it.answer || '').trim().toLowerCase()) : letter(it.answer); o.answer = k >= 0 && k !== null && k < G.options.length ? k : null; }
      else o.answer = G.bank.length ? letter(it.answer) : String(it.answer || '').trim().replace(/\s+(\/|OR)\s+/gi, ' | '); // "six / 6" → "six | 6"
      G.items.push(o);
    }
    if (type === 'gap') { // số ô ___ phải khớp số đáp án
      const k = gaps(G.html);
      if (k !== G.items.length) warn.push(`Câu ${n}+: có ${k} chỗ trống ___ nhưng ${G.items.length} đáp án, cô kiểm tra lại.`);
      while (G.items.length < k) G.items.push({ id: id(), text: '', answer: '' });
      G.items.length = k;
    }
    const from = n; n += G.items.reduce((t, it) => t + (type === 'multi' ? it.choose : 1), 0);
    if ('image' in G) warn.push(`Questions ${from}–${n - 1}: cần tải ảnh bản đồ / sơ đồ lên.`);
    const miss = G.items.filter(it => it.answer === null || it.answer === '' || (Array.isArray(it.answer) && !it.answer.length)).length;
    if (miss) warn.push(`Questions ${from}–${n - 1}: ${miss} câu chưa có đáp án.`);
    return G;
  });
  return { title: out.title || '', passages, groups, total: n - 1, answersFromKey: !!out.answers_from_key, notes: out.notes || '', warnings: warn };
}

// đề và đáp án có thể ở 2 nguồn riêng: AI ghép đáp án vào câu hỏi theo số câu
export async function parseTest(skill, { test = [], text = '', key = [], keyText = '' }) {
  const content = [{ type: 'text', text: `This is an IELTS ${skill === 'reading' ? 'Reading' : 'Listening'} test.\n\n=== TEST PAPER ===${text ? '\n' + text : ''}` }, ...test];
  if (key.length || keyText) content.push({ type: 'text', text: `=== ANSWER KEY (uploaded separately by the teacher) ===${keyText ? '\n' + keyText : ''}` }, ...key);
  try { return fromAI(await call({ model: MODEL_PARSE, system: PARSE_SYSTEM, content, schema: PARSE_SCHEMA, maxTokens: 60000 }), skill); }
  catch (e) { throw isImageErr(e) ? new Error(`Model ${MODEL_PARSE} không đọc được ảnh. Hãy dùng file PDF có chữ (không phải bản scan) hoặc dán chữ của đề.`) : e; }
}

// ===== chấm Writing =====
const GRADE_SCHEMA = obj({ band: { type: 'number', description: 'Overall band, 0-9 in steps of 0.5' }, comment_html: str, annotated_html: str });
const GRADE_SYSTEM = `You are an experienced IELTS Writing examiner grading practice work for Vietnamese teenage students.

Grade strictly against the official public IELTS Writing band descriptors (Task Response / Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy). Decide from the task whether it is Task 1 or Task 2. Do not inflate scores: an under-length, off-topic, memorised or unfinished answer is penalised as a real examiner would. If task images are attached, check the essay's data against them.

Return:
- band: the overall band (0-9, steps of 0.5).
- comment_html: feedback in Vietnamese, addressing the student as "em", warm but honest. One short paragraph per criterion with its own band, then 2-3 concrete next steps. Use only <p>, <b>, <ul>, <li>.
- annotated_html: the student's essay reproduced in full, paragraph by paragraph in <p> tags, with corrections inline. For each error write <s>wrong text</s> <b style="color:#1b6e1b">correction</b> followed by a label, one of:
  <span style="background-color:#ffd0d0;color:#a01616;font-weight:bold">[Grammar]</span>
  <span style="background-color:#ffe0b2;color:#a04a00;font-weight:bold">[Spelling]</span>
  <span style="background-color:#d6e4ff;color:#1c43a0;font-weight:bold">[Vocab]</span>
  <span style="background-color:#ead6ff;color:#5a1ea0;font-weight:bold">[Coherence]</span>
  Mark especially good phrases with <span style="background-color:#c8f0c4;color:#1b6e1b;font-weight:bold">[Good]</span>. Keep the student's text otherwise unchanged.`;

export async function gradeWriting({ taskNo, task, minWords, essay, words, images }) {
  const text = seen => ({ type: 'text', text: `This is IELTS Writing Task ${taskNo || '(decide from the task)'}.\n<task>\n${task}\n</task>\n${!seen && images.length ? '(The task picture could not be shown to you: judge data accuracy only from the essay and mention this in the feedback.)\n' : ''}Required minimum words: ${minWords || 'not stated'}\nStudent word count: ${words}\n\n<essay>\n${essay}\n</essay>` });
  const ask = withImgs => call({ model: MODEL_WRITING, system: GRADE_SYSTEM, content: withImgs ? [...images, text(true)] : [text(false)], schema: GRADE_SCHEMA, maxTokens: 16000 });
  // model chỉ đọc chữ (vd. các model :free) thì chấm lại không kèm ảnh biểu đồ Task 1
  const out = await ask(images.length > 0).catch(e => { if (images.length && isImageErr(e)) return ask(false); throw e; });
  return { band: String(Math.max(0, Math.min(9, Math.round(+out.band * 2) / 2))), comment: out.comment_html, html: out.annotated_html };
}
