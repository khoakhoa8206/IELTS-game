# IELTS QUEST — Đặc tả sản phẩm (spec)

> Phiên bản: 0.6 · Ngày: 11/10/2026
> Trạng thái: bản chạy được. Giao diện chạy trên **Netlify**, máy chủ trên **Render**, dữ liệu và file trên **Supabase**.

---

## 1. Mục tiêu

Web luyện IELTS 4 kỹ năng **Nghe / Nói / Đọc / Viết**, giao diện kiểu **game pixel-art**.

- Học sinh đi đường qua các bài giáo viên giao để tới **ĐÍCH**.
- Học sinh làm bài **trên máy riêng**. Dữ liệu đồng bộ qua máy chủ.
- Học sinh chọn làm bài nào trước cũng được, nhưng phải xong **tất cả** mới về đích.
- Hiện tại có **1 lớp IELTS**. Sau này có thể thêm nhiều lớp (mục 10).

---

## 2. Vai trò & đăng nhập

| Vai trò | Đăng nhập | Quyền |
|---|---|---|
| Học sinh | Tên đăng nhập do giáo viên tạo, mật khẩu ban đầu là **1** (bắt buộc tự đổi ở lần đăng nhập đầu) | Làm bài, nộp bài, xem điểm và nhận xét |
| Giáo viên | Tài khoản giáo viên | Cấp tài khoản, soạn và giao bài, chấm bài, khôi phục mạng |

- Học sinh quên mật khẩu: cô **đặt mật khẩu mới** ở CÀI ĐẶT, hoặc bấm **ĐẶT LẠI MK** (về 1, em tự đổi lại).
- Mỗi học sinh chỉ đăng nhập được trên **1 máy cùng lúc**.
- Sai mật khẩu 5 lần thì tài khoản bị khóa 5 phút.
- Khi tạo tài khoản, giáo viên nhập họ tên, tên đăng nhập và **số điện thoại phụ huynh**.

---

## 3. Giao diện

Giữ nguyên prototype:
- Font pixel, sprite tự vẽ, màu tươi, tiếng 8-bit.
- Hub **CHỌN KỸ NĂNG**.
- Bản đồ đường đi. Bài chưa làm hiện **đỏ**, bài đã làm hiện **xanh "✔ ĐÃ HOÀN THÀNH"**.
- Làm xong cả 4 kỹ năng thì hiện bảng **"CHÚC MỪNG EM ĐÃ HOÀN THÀNH"**.
- HUD góc trái: **3 tim = 3 mạng**, 5 sao = tiến độ.

---

## 4. Dạng bài Reading & Listening (đầy đủ theo form IELTS)

Mỗi bài gồm nhiều **nhóm câu** giống đề thật:
- Mỗi nhóm có tiêu đề "QUESTIONS 1–5" và hướng dẫn tiếng Anh (hệ thống điền sẵn câu chuẩn, giáo viên sửa được).
- Câu hỏi được **đánh số liên tục** qua các nhóm.
- Dạng *Choose TWO* chiếm 2 số câu và tính 2 điểm.

| Dạng bài | Reading | Listening | Cách học sinh làm |
|---|:-:|:-:|---|
| Multiple Choice (1 đáp án) | ✔ | ✔ | bấm A/B/C/D |
| Multiple Choice (chọn 2–3 đáp án) | ✔ | ✔ | bấm đủ số đáp án |
| True / False / Not Given | ✔ | | bấm |
| Yes / No / Not Given | ✔ | | bấm |
| Matching Headings | ✔ | | chọn i, ii, iii… theo danh sách |
| Matching Information | ✔ | | chọn đoạn A, B, C… |
| Matching Features | ✔ | ✔ | chọn A, B, C… theo danh sách |
| Matching Sentence Endings | ✔ | | chọn A–G |
| Plan / Map / Diagram Labelling | | ✔ | xem ảnh, chọn nhãn A–H |
| Form / Note / Table / Flow-chart / Summary Completion | ✔ | ✔ | gõ vào ô trống nằm ngay trong đoạn văn / bảng |
| Sentence Completion | ✔ | ✔ | gõ vào ô trống |
| Summary Completion (chọn từ trong khung) | ✔ | ✔ | chọn chữ cái của từ trong khung |
| Diagram Label Completion | ✔ | ✔ | xem ảnh, gõ vào ô trống |
| Short-answer Questions | ✔ | ✔ | gõ câu trả lời |
| Dictation (chép chính tả) | | ✔ | gõ lại từng câu, so từng từ |

**Soạn dạng điền từ:**
- Giáo viên gõ **`___`** (3 dấu gạch dưới) vào đúng chỗ cần điền trong đoạn văn hoặc bảng (dán bảng từ Word được).
- Mỗi `___` tự thành một câu.
- Đặt **giới hạn số từ**, ví dụ NO MORE THAN TWO WORDS. Học sinh viết quá số từ thì bị tính sai, như thi thật.
- Nhiều đáp án được chấp nhận thì ngăn cách bằng `|`, ví dụ `9 | nine`.

**Reading** có tối đa **3 passage**, học sinh bấm thẻ PASSAGE 1/2/3 để chuyển. **Listening** chia **PART 1–4**, dùng một file mp3.

**Soạn bài Reading / Listening:** cô chỉ nhập **tên bài + hạn nộp** (Listening thêm file mp3). Đề bài, passage / section và dạng câu hỏi do **AI tự nhận diện và dựng đúng format đề thi**; cô không cần tự thêm passage hay câu hỏi, chỉ **kiểm tra, sửa hoặc xóa** chỗ sai trước khi giao. Listening chia theo **Section** đúng như đề (3 hoặc 4 section).

**🤖 Nhập đề bằng AI (OpenRouter):**
1. Ở màn hình soạn bài Reading/Listening, khung AI có 2 ô riêng: **① ĐỀ BÀI** và **② ĐÁP ÁN**. Mỗi ô nhận file PDF, ảnh chụp, hoặc chữ dán. AI ghép đáp án vào câu hỏi theo số câu (hiểu cả viết tắt T/F/NG, nhiều đáp án như "six / 6").
2. AI dựng đủ passage, câu hỏi (đúng dạng, đánh số 1–40) và đáp án. Việc này chạy nền khoảng 1–3 phút.
3. Hệ thống báo: đáp án lấy từ trang đáp án hay do AI tự giải; những chỗ cần kiểm tra (số chỗ trống lệch, câu thiếu đáp án, ảnh bản đồ cần tải lên).
4. Cô bấm **XEM TRƯỚC + ĐÁP ÁN** để xem toàn bộ đề như học sinh thấy, đáp án tô xanh, câu thiếu đáp án tô đỏ. Sửa xong mới lưu và giao.
- Listening: AI chỉ đọc giấy đề; mp3 cô tự tải lên. Không có trang đáp án thì cô tự điền đáp án.

**Bút tô màu (Reading):** học sinh bôi đen chữ trong bài đọc là tô vàng (tô qua nhiều đoạn được), bấm vào chỗ đã tô để xóa, có nút XÓA HẾT. Mỗi passage giữ chỗ tô riêng khi chuyển qua lại. Vẫn không copy được đề.

**Luật làm bài:**
- **Chỉ làm 1 lần.** Nộp xong có điểm và đáp án ngay. Máy chủ chấm điểm.
- Cần cho làm lại thì giáo viên bấm **CHO LÀM LẠI**.
- **Listening nghe tối đa 2 lần**:
  - Không tua được, chỉ tạm dừng được.
  - Máy chủ đếm lượt nghe, tải lại trang không được thêm lượt.
  - Nộp xong thì nghe lại thoải mái.

---

## 5. Writing & Speaking

**Writing** (2 task như đề thật)
- Cô soạn **Task 1** (đề + biểu đồ/hình, mặc định 150 từ) và **Task 2** (bài luận, không cần hình, mặc định 250 từ). Muốn giao 1 task thì để trống task còn lại.
- Học sinh bấm thẻ **TASK 1 / TASK 2** để chuyển, mỗi task một khung viết và bộ đếm từ riêng; gõ hoặc dán bài.
- **AI chấm từng task** (band + nhận xét tiếng Việt + sửa lỗi trên bài). **Band tổng** = (Task 1 + Task 2 × 2) / 3, làm tròn 0.5 như IELTS. Cô sửa band từng task, band tổng tự tính lại.

**Speaking** (phòng thi có giám thị)
- Cô soạn 3 phần: **Part 1** (câu hỏi quen thuộc), **Part 2** (thẻ chủ đề), **Part 3** (thảo luận). Mỗi phần tự thêm bao nhiêu câu cũng được.
- Học sinh vào phòng thi: **giám thị pixel** (hình do cô thiết kế) mấp máy miệng, **đọc thành tiếng** từng câu (giọng Anh nếu máy có), chữ chạy từng chữ trong khung hội thoại. Mỗi phần có lời mở đầu như thi thật.
- **Part 1, 3:** đọc xong hiện nút micro, học sinh tự bấm trả lời, tự dừng. Cảnh báo dưới 15 giây / trên 40 giây. Có nút nghe lại câu hỏi.
- **Part 2:** đọc thẻ chủ đề → **1 phút chuẩn bị** (có ô ghi chú, có nút "Em đã sẵn sàng") → **báo trước 5 giây** → **micro tự mở** → học sinh tự dừng, hoặc **tự tắt ở 2 phút 15 giây**.
- Mỗi câu là một file ghi âm riêng, làm lại được từng câu. Qua câu sau thì giám thị lại đọc tiếp. Thoát ra vào lại thì làm tiếp từ câu chưa ghi.
- Cô nghe từng file, nhận xét từng câu, cho band.

---

**Lịch sử bài làm:** học sinh bấm vào **ô tên** ở trang chủ để xem mọi bài đã nộp (điểm, thời gian, nộp trễ hay không). Bấm vào một bài để xem lại toàn bộ bài làm, có đáp án đúng. Đổi nhân vật nằm ở nút **NHÂN VẬT**.

**Nhạc nền:** vào làm bài (cả 4 kỹ năng) là nhạc **tự tắt và ô nhạc ẩn hẳn**, ra khỏi bài thì bật lại. Chép file nhạc (mp3, m4a, ogg, wav…) vào thư mục **`public/music`**, web tự phát lần lượt theo tên file (đặt `01 ...`, `02 ...` để sắp thứ tự). Góc dưới trái có đĩa pixel xoay, nút ▶/❚❚ và ⏭. Nhạc bật sau lần bấm đầu tiên vào trang, tự tạm tắt khi làm Listening / Speaking. Thư mục trống thì không hiện máy phát.

## 6. Mạng (3 trái tim) & báo phụ huynh

1. Mỗi bài **nộp sau hạn**, hoặc **quá hạn mà chưa nộp**, mất 1 mạng. Vì vậy hạn nộp là bắt buộc khi soạn bài.
2. **Hết 3 mạng:** tab HỌC SINH của giáo viên hiện khung đỏ **"HỌC SINH ĐÃ HẾT MẠNG"** kèm **số điện thoại phụ huynh** để cô gọi. Học sinh thấy thông báo "Cô sẽ liên hệ với phụ huynh" và vẫn làm bài tiếp được.
3. Sau khi liên hệ phụ huynh, giáo viên bấm **KHÔI PHỤC 3 MẠNG**.

---

## 7. Chống gian lận

| Biện pháp | Cách làm |
|---|---|
| Không lộ đáp án | Học sinh chưa nộp thì không nhận được đáp án, transcript hay link audio. Máy chủ tự chấm. |
| Chỉ làm 1 lần | Máy chủ từ chối nộp lần hai. |
| Nghe 2 lần | Máy chủ đếm lượt nghe. Link audio chỉ được cấp khi còn lượt. |
| Đồng hồ thật | Máy chủ giữ thời gian làm bài. |
| Rời bài | Chuyển tab hoặc mở ứng dụng khác bị ghi lại. Giáo viên thấy "Rời bài n lần". |
| Sao chép đề | Reading/Listening chặn copy và chuột phải. |
| Dán bài Writing | Vẫn cho dán, nhưng ghi lại số ký tự đã dán. |
| Dùng chung tài khoản | Mỗi tài khoản chỉ đăng nhập trên 1 máy cùng lúc. |
| Speaking | Chỉ ghi âm trực tiếp. File chỉ được lưu vào thư mục của chính học sinh. |

---

## 8. Giao bài

- Giáo viên soạn bài ở dạng **BẢN NHÁP**, rồi bấm **GIAO BÀI <KỸ NĂNG>** ở tab của kỹ năng đó.
- **Giao theo từng kỹ năng:** chỉ cần các bài nháp của kỹ năng đó đầy đủ (tên, hạn nộp, nội dung, đáp án...) là giao được, không phải chờ các kỹ năng khác. Thiếu gì thì hiện bảng **KIỂM TRA LẠI**.
- Bài đã giao khi sửa vẫn phải đầy đủ mới lưu được.
- Học sinh **về đích** khi làm xong hết bài của các kỹ năng đã được giao (kỹ năng chưa có bài không chặn).

---

## 9. Kỹ thuật & triển khai

```
Trình duyệt ──► Netlify (public/index.html)
                  │  /api/*  (proxy, cùng tên miền → cookie đăng nhập an toàn)
                  ▼
               Render (server.js, Node) ──► Supabase Postgres (bảng users, sessions, assignments, subs)
                  │                    └─► OpenRouter (AI đọc đề, chấm Writing)
                  └─ cấp link ký tạm ──► Supabase Storage (bucket riêng tư "media": audio, ảnh, ghi âm)
Trình duyệt tải / nghe file trực tiếp với Supabase Storage bằng link ký tạm (file lớn không đi qua Render).
```

| File | Vai trò |
|---|---|
| `public/index.html` | Toàn bộ giao diện (một file) |
| `server.js` | API, chấm điểm, mạng, báo phụ huynh, AI chấm |
| `ai.js` | Gọi OpenRouter: đọc đề thành câu hỏi, chấm Writing |
| `db.js` | Đọc/ghi Supabase. Không cấu hình Supabase thì dùng bộ nhớ tạm (để chạy thử và kiểm thử) |
| `supabase/schema.sql` | Tạo bảng và bucket |
| `netlify.toml` · `render.yaml` | Cấu hình triển khai |
| `test/server.test.js` | `npm test`: chạy máy chủ thật, đi hết luồng giáo viên → học sinh |

### Các bước đưa lên mạng

**1. Supabase**
- Tạo project.
- Vào **SQL Editor**, dán `supabase/schema.sql` rồi bấm **Run**.
- Vào **Project Settings → API**, chép **Project URL** và khóa **service_role**. Khóa service_role chỉ dán vào Render, không bao giờ đưa vào giao diện.

**2. Render**
- **New → Blueprint**, chọn repo, Render đọc `render.yaml`.
- Điền các biến môi trường:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `TEACHER_PASSWORD`
  - `OPENROUTER_API_KEY` (lấy ở openrouter.ai/keys; có thể đổi `OPENROUTER_MODEL`, `OPENROUTER_WRITING_MODEL`)
- Ghi lại địa chỉ dạng `https://ielts-quest-api.onrender.com`.

**3. Netlify**
- **Add new site → Import from Git**, chọn repo. Thư mục publish là `public` (đã khai báo trong `netlify.toml`).
- **Sửa địa chỉ Render** trong `netlify.toml` nếu khác `ielts-quest-api.onrender.com`.

**5. Chạy thử trên máy:**
- `npm install`, rồi `npm start`, mở http://localhost:3000.
- Không có `.env` thì máy chủ chạy bằng bộ nhớ tạm.

**Lưu ý về Render bản miễn phí:**
- Máy chủ **ngủ sau 15 phút** không có ai dùng. Lần mở đầu tiên phải đợi khoảng 1 phút; giao diện tự thử lại và báo "Máy chủ đang khởi động".
- Khi cả lớp dùng thường xuyên, nên dùng gói Starter để không phải chờ.

---

## 10. Còn mở / làm sau

1. **Nhiều lớp:** thêm bảng `classes` và cột lớp cho học sinh và bài tập. Hiện tại mọi bài giao cho cả lớp.
2. Báo phụ huynh: cô gọi điện theo SĐT hiện trong tab HỌC SINH (chưa tự gửi tin nhắn).
3. Chưa thử trên mọi thiết bị, đặc biệt là ghi âm trên Safari iPhone/iPad.
4. Chưa có nút sao lưu trên web. Supabase tự sao lưu hằng ngày ở gói Pro; gói Free nên tự xuất dữ liệu định kỳ.

---

## 11. Nhân vật tự chọn (chia theo giới tính)

| Nhóm | Nữ | Nam |
|---|---|---|
| Kiểu tóc | dài, ngang vai, đuôi ngựa, búi, bím 2 bên, xoăn | ngắn, rẽ ngôi, dựng, húi cua, xoăn ngắn, vuốt ngược |
| Áo | áo thun, áo cổ sen, hoodie, áo len sọc, áo khoác, váy liền, đồng phục | áo thun, áo polo, sơ mi + cà vạt, hoodie, áo len sọc, áo khoác, đồng phục |
| Quần | chân váy, quần dài, quần short | quần dài, quần short |
| Mũ / nón | không, nơ, mũ nồi, lưỡi trai, mũ len, vương miện, tai nghe, nón lá | như nữ, trừ nơ |
| Kính | không, kính thường, kính tròn, kính đen | như nữ |
| Râu | — | không, ria mép, quai nón |

Chung: 5 màu da, 10 màu tóc, 10 màu áo, 9 màu quần, giày da / thể thao / bốt với 8 màu, 8 màu mũ, nút 🎲 NGẪU NHIÊN. Đổi giới tính thì món không hợp tự đổi về món mặc định của giới tính đó. Nhân vật lưu từ bản trước vẫn hiện đúng.
