-- Durable ciphertext queue for Arweave uploads.
-- The browser encrypts first. This table stores only the encrypted envelope
-- plus non-secret metadata. Plaintext never belongs here.
-- Status is changed only by the service role worker, never by clients.

create table if not exists public.arweave_upload_queue (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot_version integer not null check (snapshot_version > 0),
  ciphertext text not null check (char_length(ciphertext) between 1 and 70000000),
  metadata jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'uploaded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  tx_id text check (tx_id is null or tx_id ~ '^[A-Za-z0-9_-]{43}$'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  uploaded_at timestamptz,
  unique (user_id, content_hash)
);

create index if not exists arweave_upload_queue_due_idx
  on public.arweave_upload_queue (status, next_retry_at, created_at);

alter table public.arweave_upload_queue enable row level security;

drop policy if exists "users read own arweave queue" on public.arweave_upload_queue;
create policy "users read own arweave queue"
  on public.arweave_upload_queue for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own arweave queue" on public.arweave_upload_queue;
create policy "users insert own arweave queue"
  on public.arweave_upload_queue for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and attempts = 0
    and tx_id is null
  );

revoke update, delete on public.arweave_upload_queue from anon, authenticated;
