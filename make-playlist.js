// Danh sách nhạc nền = các file nhạc trong public/music (chép file mp3 vào đó là xong).
// Máy cá nhân: server.js đọc thư mục mỗi lần mở trang. Netlify: lệnh build chạy file này để tạo public/music/playlist.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MUSIC_DIR = new URL('./public/music/', import.meta.url);
export const AUDIO_TYPE = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };

export function listMusic() {
  let files = [];
  try { files = fs.readdirSync(MUSIC_DIR); } catch { return []; }
  return files
    .filter(f => AUDIO_TYPE[f.split('.').pop().toLowerCase()] && !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
    .map(f => ({ file: 'music/' + encodeURIComponent(f), name: f.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const list = listMusic();
  fs.writeFileSync(new URL('playlist.json', MUSIC_DIR), JSON.stringify(list, null, 1));
  console.log(`Nhạc nền: ${list.length} bài → public/music/playlist.json`);
}
