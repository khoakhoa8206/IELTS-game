-- Chạy một lần trong Supabase: Dashboard → SQL Editor → New query → dán file này → Run.
-- Bảng chỉ được truy cập qua máy chủ (service_role key). RLS bật, không có policy → không ai khác đọc được.

create table if not exists users (
  username      text primary key,
  name          text not null,
  role          text not null check (role in ('teacher', 'student')),
  pass          text not null,
  bonus         int  not null default 0,   -- số mạng được cô hồi lại
  parent_phone  text,                      -- số điện thoại phụ huynh (gọi khi em hết mạng)
  must_change   boolean not null default false, -- tài khoản mới (mật khẩu 1) phải đổi mật khẩu khi đăng nhập
  zero_at       bigint,                    -- lúc phát hiện hết mạng (đã báo phụ huynh)
  notify_status text,
  avatar        jsonb,                     -- nhân vật học sinh tự chọn
  classes       jsonb not null default '[]', -- mã các lớp em thuộc về
  created       bigint
);
-- cho database đã tạo từ bản trước
alter table users add column if not exists avatar jsonb;
alter table users add column if not exists must_change boolean not null default false;
alter table users add column if not exists classes jsonb not null default '[]';

create table if not exists classes (
  id      text primary key,
  name    text not null,
  created bigint
);

create table if not exists sessions (
  token    text primary key,
  username text not null references users(username) on delete cascade,
  created  bigint
);

create table if not exists assignments (
  id   text primary key,
  data jsonb not null
);

create table if not exists subs (
  key      text primary key,
  aid      text not null references assignments(id) on delete cascade,
  username text not null references users(username) on delete cascade,
  data     jsonb not null
);
create index if not exists subs_aid on subs(aid);
create index if not exists subs_username on subs(username);
create index if not exists sessions_username on sessions(username);

alter table users       enable row level security;
alter table sessions    enable row level security;
alter table assignments enable row level security;
alter table subs        enable row level security;
alter table classes     enable row level security;

-- kho file riêng tư: audio bài nghe, ảnh đề, file ghi âm Speaking, PDF đề cho AI đọc (tối đa 100 MB/file)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 104857600, array['audio/*', 'image/*', 'application/pdf'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;
