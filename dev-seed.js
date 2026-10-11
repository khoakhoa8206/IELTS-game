// Dữ liệu mẫu cho `npm run dev` (chỉ chạy ở chế độ bộ nhớ tạm): 1 học sinh + 1 bài đã giao cho mỗi kỹ năng.
import * as db from './db.js';

// file nghe mẫu: tiếng "bíp" 3 giây (WAV), để thử nút nghe 2 lần
function beepWav(sec = 3, rate = 8000) {
  const n = sec * rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000 * (i % rate < rate / 2 ? 1 : 0)), 44 + i * 2);
  return buf;
}

export async function seed(hashPw) {
  await db.insertUser({ username: 'hocsinh', name: 'Hoàng Thơ', role: 'student', pass: hashPw('123456'), bonus: 0, created: Date.now(), parent_name: 'Mẹ Thơ', parent_phone: '0901234567' });

  const audio = 'media/demo.wav';
  const token = (await db.signUpload(audio)).split('/').pop();
  db.memFile.put(token, 'audio/wav', beepWav());

  const bars = [['Vietnam', 20, 65], ['Japan', 35, 70], ['UK', 40, 80]].map(([c, x, y], k) => `<rect x="${40 + k * 90}" y="${180 - x * 1.6}" width="30" height="${x * 1.6}" fill="#8ec5ff"/><rect x="${72 + k * 90}" y="${180 - y * 1.6}" width="30" height="${y * 1.6}" fill="#2c3e6b"/><text x="${70 + k * 90}" y="198" font-size="12" text-anchor="middle">${c}</text>`).join('');
  const chart = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210"><rect width="320" height="210" fill="#fff"/>${bars}<text x="160" y="16" font-size="12" text-anchor="middle">% students studying online (2010 / 2020)</text></svg>`).toString('base64');
  const week = Date.now() + 7 * 864e5, base = { published: true, publishedAt: Date.now(), createdAt: Date.now() };
  const list = [
    { ...base, id: 'demo-read', skill: 'reading', title: 'The History of Tea', deadline: week, order: 1,
      passages: ['<p><b>A</b> Tea was first drunk in China more than 4,000 years ago, mostly as a medicine.</p><p><b>B</b> In the 17th century, Dutch traders brought tea to Europe, where it quickly became fashionable.</p><p><b>C</b> Today, tea is the second most popular drink in the world after water.</p>'],
      groups: [
        { id: 'g1', preset: 'tfng', type: 'tfng', instructions: 'Do the following statements agree with the information given in the passage?\nWrite TRUE, FALSE or NOT GIVEN.',
          items: [{ id: 'r1', text: 'Tea was first used as a medicine.', answer: 'TRUE' }, { id: 'r2', text: 'The Dutch disliked tea.', answer: 'FALSE' }] },
        { id: 'g2', preset: 'headings', type: 'match', labels: 'roman', title: 'List of Headings', instructions: 'Choose the correct heading for each paragraph from the list of headings below.',
          options: ['Tea arrives in Europe', 'A drink loved worldwide', 'Ancient origins', 'How tea is grown'],
          items: [{ id: 'r3', text: 'Paragraph A', answer: 2 }, { id: 'r4', text: 'Paragraph B', answer: 0 }, { id: 'r5', text: 'Paragraph C', answer: 1 }] },
        { id: 'g3', preset: 'notes', type: 'gap', maxWords: 2, instructions: 'Complete the notes below.\nWrite NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.',
          html: '<p>First drunk in: ___</p><p>Brought to Europe by: ___ traders</p>', items: [{ id: 'r6', answer: 'China' }, { id: 'r7', answer: 'Dutch' }] },
        { id: 'g4', preset: 'multi', type: 'multi', instructions: 'Choose TWO letters, A–E.',
          items: [{ id: 'r8', text: 'Which TWO facts about tea are mentioned?', options: ['Its age', 'Its price', 'Its popularity', 'Its colour', 'Its taste'], choose: 2, answer: [0, 2] }] },
      ] },
    { ...base, id: 'demo-listen', skill: 'listening', title: 'Hotel Booking (Section 1)', deadline: week, order: 1, mode: 'questions', audio,
      groups: [
        { id: 'l1', preset: 'notes', type: 'gap', maxWords: 2, instructions: 'Complete the form below.\nWrite NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.',
          html: '<table><tr><td>Name</td><td>___</td></tr><tr><td>Nights</td><td>___</td></tr></table>', items: [{ id: 'l1a', answer: 'Smith' }, { id: 'l1b', answer: '3 | three' }] },
        { id: 'l2', preset: 'mcq', type: 'mcq', instructions: 'Choose the correct letter, A, B or C.',
          items: [{ id: 'l2a', text: 'The guest wants a room with', options: ['a sea view', 'a balcony', 'two beds'], answer: 0 }] },
      ] },
    { ...base, id: 'demo-write', skill: 'writing', title: 'Writing Test 1', deadline: week, order: 1,
      tasks: [
        { no: 1, minWords: 150, images: [chart], prompt: '<p>The chart below shows the percentage of students who studied online in three countries in 2010 and 2020.</p><p>Summarise the information by selecting and reporting the main features, and make comparisons where relevant.</p>' },
        { no: 2, minWords: 250, images: [], prompt: '<p>Some people think that studying online is better than studying in a classroom. To what extent do you agree or disagree?</p>' },
      ] },
    { ...base, id: 'demo-speak', skill: 'speaking', title: 'Speaking Test 1', deadline: week, order: 1,
      questions: [
        { id: 's1', part: '1', text: 'What do you like to do in your free time?' },
        { id: 's2', part: '1', text: 'Do you prefer indoor or outdoor activities? Why?' },
        { id: 's3', part: '2', text: `Describe a hobby you enjoy.
You should say:
- what the hobby is
- when you started it
- how often you do it
and explain why you enjoy it.` },
        { id: 's4', part: '3', text: 'Why do you think some people have no hobbies?' },
        { id: 's5', part: '3', text: 'How have popular hobbies changed in your country?' },
      ] },
  ];
  // một bài giao từ tháng trước, để thử chuyển tháng trên bản đồ
  const lastMonth = new Date(); lastMonth.setDate(1); lastMonth.setMonth(lastMonth.getMonth() - 1);
  list.push({ ...base, id: 'demo-read-old', skill: 'reading', title: 'Coffee (tháng trước)', deadline: week, order: 0, publishedAt: lastMonth.getTime(), createdAt: lastMonth.getTime(),
    passages: ['<p><b>A</b> Coffee was first grown in Ethiopia.</p><p><b>B</b> It reached Europe in the 17th century.</p>'],
    groups: [{ id: 'o1', preset: 'tfng', type: 'tfng', section: 1, instructions: 'Write TRUE, FALSE or NOT GIVEN.', items: [{ id: 'o1a', text: 'Coffee was first grown in Ethiopia.', answer: 'TRUE' }] }] });
  for (const a of list) await db.putA(a);
}
