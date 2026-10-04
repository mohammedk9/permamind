# Group Rooms â€” Design Document

Status: approved design, not yet implemented.
Scope: a third conversation type alongside the existing private chat and the memory page.

This document records the decisions taken before any code is written. Where a decision
changed during discussion, the earlier version and the reason for the change are noted,
because the discarded options are the ones most likely to be re-proposed later.

---

## 1. What a room is

A room is a shared space where several people and an AI model hold one conversation. The
host brings their own AI provider key, opens the room, and shares a link. Guests join
without an account and without a key, and the model takes part in the same thread.

The AI reads **the room transcript and nothing else**. It never reads the host's private
conversations, the memory ledger, or any other local data. This is the property the whole
design is built around, and it is what makes the feature safe to offer to strangers.

The room is local-first in the sense that matters: content is encrypted in the browser
before it leaves the device, and the server stores ciphertext it cannot read. The one
deliberate exception is the host's AI key when they choose the "keep on the server" option,
described in section 5, which is always disclosed before it is chosen.

---

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | Supabase, ciphertext only | The server stores what it cannot read. ~200KB per room; the cost is negligible. |
| AI provider | Any BYOK provider already in the app | The host uses OpenRouter, Claude, Gemini, or whichever they configured. Not restricted to one vendor. |
| Opening condition | A room cannot be created without an AI key | Without a key there is no model in the room, and the feature would be a group chat app. |
| AI context | Room transcript only | The host is not in the model's context at all, so nothing about them can leak. |
| AI key location | Browser only, or server (host's choice) | See section 5. Explicit consent, revocable. |
| Who may use the AI | Host plus members the host grants it to | The host picks exactly who spends their quota. |
| Guests | No account. Link plus a code | No friction, no personal data collected. |
| Room lifetime | Host sets it, with no "forever" option | A room is a meeting, not an archive. See section 10. |
| Room quota | Two active rooms per host per rolling month | The constraint that makes a paid tier possible, and bounds free storage. |
| Display names | Required, host's choice to relax, encrypted in the payload | A room of "Guest 4f2" cannot be moderated or followed. |
| Roles | `host`, `trusted`, `guest` | `trusted` may invoke the model; `guest` may not, until granted. |
| Quota of the model | The host's own key, always | Rooms never touch the free tier. A room and the free chat quota are unrelated systems. |
| Closing a room | Deletes it immediately | A room that cannot be read is still a stored record. See section 10. |

### Discarded options

**A memory-based AI (an earlier version of this design).** The first draft had the AI read
the host's personal memory to be "smarter", guarded by a privacy filter that stripped any
answer not backed by approved material. It was dropped for two reasons. First, the filter
is the hardest part of the system to get right, and a filter that fails leaks silently.
Second, and more decisively, the host did not want it: a model that knows about the host's
other conversations stops being a guest and starts being a proxy for the host's private
life. Restricting the context to the room removes the entire class of problem instead of
mitigating it.

**Peer-to-peer for the transcript.** This would have made Supabase unnecessary for
messages. It was rejected because a model needs a key that lives on a device, so someone
must be online to serve the AI regardless; WebRTC then adds signalling, TURN, and NAT
traversal to a system that already needs a server for presence. The complexity buys a
storage cost that is not actually a problem.


---

## 3. The three secrets

The design has four distinct secrets. Conflating any two of them creates a vulnerability,
so they are separated by construction and never derived from one another.

| Secret | Where it lives | Purpose |
| --- | --- | --- |
| **Room key** | Host's browser memory, never stored and never transmitted | Encrypts and decrypts every room message. A leak of everything else still leaves the content unreadable. |
| **Room id** | In the link. Not a secret. | Addresses the room: `permamind.app/r/7K9P2X`. Six characters from a non-sequential alphabet. |
| **Invite code** | Sent to guests, stored hashed on the server | Proves a guest may join. Grants read/write, not the ability to decrypt on its own. |
| **Host code** | Host only, stored hashed | Grants administration: pin, kick, promote, close. Never sent to a guest. |

### Why a leaked invite code does not expose the room

The guest never receives the room key. On joining, the server releases a **wrapped key**:
the room key encrypted with a key derived from the invite code. A guest unwraps it locally
and can then read and write.

If the link and the invite code both leak, an attacker gets the wrapped key and nothing
else. Unwrapping still requires the room key, which never leaves the host's device. The
content stays encrypted even though access to the room's storage is open.

The invite code and the host code are checked against separate hashes and grant different

---

## 4. Roles and the AI permission

| Role | Read | Write | May invoke the AI | Granted by |
| --- | --- | --- | --- | --- |
| `host` | Yes | Yes | Yes | The creator |
| `trusted` | Yes | Yes | Yes | The host, explicitly |
| `guest` | Yes | Yes | No | The default for anyone who joins |
| Read-only | Yes | No | No | The host switching a room to read-only |

The default is that a guest may write but may not invoke the model. The host promotes
individuals to `trusted` as they choose. This is the whole of the quota control: the host
decides who spends their key.

A guest never needs an account, a key, or an email address. Their identity is a random
member token the server issues at join time; only a hash of it is stored, and it is
revocable by the host at any moment by removing the member row.

Guests are asked for a display name, and the host can make it mandatory for the room. The
name travels inside the encrypted message payload rather than in a column, so the server
stores it as ciphertext like everything else. The server can therefore enforce "a name was
provided" without ever learning what it was, which is the only part of the check it needs.

A promoted member is told plainly that the host's key is now being used on their behalf, and
by how much they have spent. A guest who is not promoted is never charged, so the exposure
to the host's bill is bounded by the number of people the host has chosen to trust.

---

## 5. Where the AI key lives

### Disclosure shown before Option B is selected

Stated plainly, not in a confirmation dialog that can be dismissed without reading:

- The key will be stored on PermaMind's server, encrypted.
- It exists so the model can answer while the host is not present.
- It is used only to sign requests to the provider the host chose.
- The host can delete it at any time from Settings, and deleting it stops the model for
  every room that was using it.

### Deletion and expiry

- Settings shows a "Remove room key" action. It deletes the stored key, which makes every
  room that relied on it fall back to Option A behaviour.
- The host may set an expiry: the key is deleted automatically after a chosen number of
  days, or kept until they delete it.
- Deleting the key is not recoverable. Rooms keep their transcripts.

### The transparency problem, and the honest answer

A guest joining a room reasonably expects the model to keep replying, because every other
product they use behaves that way regardless of who is present. The disclosure above is
honest but it does not make the expectation true, and a guest has no way to check whether
the host chose Option A or Option B.

The room shows a persistent line, to everyone, whenever the model is answering: that the
model is running on the host's key. It does not say where the key is stored, because that
is the host's decision and not the guest's business. A guest who is uncomfortable can
leave, and the host is not given the guest's identity when they do.

This is a genuine gap between expectation and reality. It is recorded here rather than
papered over, and the fallback to Option A is the reason this is acceptable for a first
release.

---

## 6. Data model

Every content column holds ciphertext. The server learns who is in a room and when it
expires, and nothing about what was said.

### `rooms`

```sql
create table if not exists public.rooms (
  room_id text primary key,                    -- 6 chars, random alphabet
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code_hash text not null,
  host_code_hash text not null,
  wrap_salt text not null,                     -- for deriving the invite wrap key
  wrapped_room_key text not null,              -- room key sealed under the invite code
  settings_ciphertext text,                    -- title, topic, phase, mode
  ai_provider text,                            -- provider id, not a secret
  ai_model text,
  key_mode text not null check (key_mode in ('browser', 'server')),
  key_expires_at timestamptz,                 -- optional auto-delete
  allow_guest_write boolean not null default true,
  require_display_name boolean not null default true,
  room_quota integer not null default 2,       -- active rooms this host may hold
  ai_audience text not null default 'trusted' check (ai_audience in ('trusted', 'all')),
  expires_at timestamptz not null,             -- required; there is no open-ended room
  created_at timestamptz not null default now()
);
```

`expires_at` is `not null` on purpose. Making the column nullable would let an open-ended
room exist through a path the form does not offer, and an unbounded room is precisely what
the lifetime rule exists to prevent.

`room_quota` is stored per room rather than read from a global constant so that a paid tier
is a number in one place, not a code change. The enforcement in the create route reads the
quota of the host, which for a free account is 2.

The provider and model are stored in the clear because they are not credentials, and the
room has to be able to pick a model without asking the host's device for anything.

### `room_members`

```sql
create table if not exists public.room_members (
  room_id text not null references public.rooms(room_id) on delete cascade,
  member_token_hash text not null,             -- hash of the member token, never the token
  role text not null check (role in ('host', 'trusted', 'guest')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (room_id, member_token_hash)
);
```

No display name is required. A guest is shown as "Guest" plus a short suffix derived from
their member token, so two guests are distinguishable without either of them declaring an
identity. An optional alias is encrypted in the message payload, not stored in the clear.

### `room_messages`

```sql
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(room_id) on delete cascade,
  seq bigint generated always as identity,     -- stable ordering under equal timestamps
  author_token_hash text not null,
  ciphertext text not null,                    -- { body, reply_to, thread_root, alias }
  ciphertext_bytes integer not null check (ciphertext_bytes > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  kind text not null default 'human' check (kind in ('human', 'ai', 'system')),
  phase int,
  pinned_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_seq on public.room_messages (room_id, seq);
```

`seq` exists because `created_at` alone is not a total order: two messages written in the
same millisecond would otherwise sort unpredictably between clients, and the transcript
must be identical for everyone.

### `room_ideas` and `room_votes`

```sql
create table if not exists public.room_ideas (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(room_id) on delete cascade,
  ciphertext text not null,                    -- the idea text
  author_token_hash text not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'dropped')),
  task_id text,                                -- set when converted on the host's device
  created_at timestamptz not null default now()
);

create table if not exists public.room_votes (
  room_id text not null references public.rooms(room_id) on delete cascade,
  idea_id uuid not null references public.room_ideas(id) on delete cascade,
  voter_token_hash text not null,
  vote smallint not null check (vote in (-1, 1)),
  primary key (room_id, idea_id, voter_token_hash)
);
```

The primary key on votes is what makes a vote per person per idea a database guarantee
rather than a UI convention.

---

## 7. Authorization

Rooms are not owned by an account, so the RLS model differs from every other table in this
project. Every existing table keys on `auth.uid() = user_id`. A guest has no account, so
that pattern cannot express "a member of this room".

The rule is instead: a member token, presented in a header, must match a row in
`room_members` for the room being read. A Postgres function resolves the caller to a role
and every policy consults it.

```sql
create or replace function public.room_role(p_room_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.room_members m
  where m.room_id = p_room_id
    and m.member_token_hash = public.room_token_hash()
  limit 1;
$$;
```

The helper reads a request header set by the API route. Because the function is
`security definer`, it can read `room_members` without the caller having table access, and
`search_path` is pinned so a hostile schema cannot shadow it.

Policies that follow from it:

| Operation | Condition |
| --- | --- |
| Read messages | `room_role(room_id) is not null` |
| Insert message | `room_role(room_id) in ('host', 'trusted', 'guest')` and `rooms.allow_guest_write`, or the room is read-only and the caller is the host |
| Update or pin | `room_role(room_id) = 'host'` |
| Delete a member | `room_role(room_id) = 'host'` |
| Read room row | `room_role(room_id) is not null`, or the caller is presenting a valid invite code during a join |

The API route is the only writer. Guests never call Supabase directly with the anon key
and a hand-built request; every read and write passes through a Next.js route that
attaches the member token server-side. This is what keeps the room key off the wire and
lets the invite code be verified in one place.

---

## 8. The AI in a room

### What the model receives

The complete request body is built from the room only:

1. A system prompt stating the room's topic and that the participants are a team.
2. The last N room messages, in `seq` order, filtered to those the caller is entitled to
   see.
3. The current question, if the caller invoked the model rather than posting a message.

Nothing else is read. Not the host's private chat, not the memory ledger, not the embedding
index, not local storage. This is enforced by construction: the request is assembled in
`lib/rooms/ai-bridge.ts`, which has no import path to any of those modules, and a test
asserts that the built request contains no data from outside the room.

That test is the one that matters. A future change that adds "just a little context from
memory" would be caught by it, which is why it is written as an assertion about the request
body rather than as a review note.

### Two invocation modes

- **Reactive.** The model replies to a message the host or a trusted member has asked it
  to answer. The transcript stays a conversation.
- **On demand.** A member presses "Ask the model" on a specific message, and the model
  answers that message in context. This is what makes the room useful for brainstorming:
  the model responds to the thread rather than driving it.

The model never speaks unprompted. An unprompted model in a room with a paid key is a cost
the host did not agree to.

### Where the request is signed

- **Option A.** The host's browser posts to the AI route with its own key in the request
  header, the same path private chat uses today. Nothing new is stored.
- **Option B.** The API route loads the stored key, decrypts it, signs the request, and
  discards it. The key is read per request and never written to a log.

In both cases the provider request carries the room transcript. The host's provider
therefore receives what was said in the room, which is stated in the room's own disclosure.
The host's private conversations are never in that request, so no provider ever sees them
because of a room.


---

## 9. Beyond a group chat

A room is not a private chat with extra people in it. The features below exist because
brainstorming fails when everything is a flat transcript.

| Feature | Why it exists |
| --- | --- |
| Reply to a message | Keeps a thread attached to what it responds to instead of in a wall of text. |
| Threads | A tangent can branch without burying the main line. |
| Pinning | A group converges on a few items; those need to stop scrolling away. Host only. |
| Ideas board | Ideas are units, not sentences, and they outlive the discussion. |
| Voting | Turns a brainstorm into a decision input. One vote per person per idea, enforced by a primary key. |
| Idea to task | The point of the exercise. Creates a task on the host's device, not a suggestion. |
| Stage summary | A long room needs a checkpoint the host can hand to someone who was not there. Produced by a host button, never automatically. |
| Approved decision | Only host-approved items become permanent memory. Everything else expires with the room. |
| Presence | Knowing who is present changes how people speak. |
| Phases | A brainstorm has a problem phase, an ideas phase, and a decision phase. Phases mark the shift. |

### What leaves the room and what does not

- **A host-approved decision** is summarised first — the decision and its reasoning, not the
  raw thread — and only then written into the host's memory ledger, where it behaves like any
  other decision: pinnable, correctable, supersedable. The host presses the summarise button on
  the decision, and the summary comes from the model call that presents it for approval, so
  confirming it costs one call rather than two.
- **A converted idea** becomes a project task on the host's device.
- **Everything else stays in the room** and is deleted when the room closes or expires. A
  brainstorm is not a record, and treating it as one is how a memory system fills up with noise.

This boundary is deliberate. The memory ledger is the host's private record; a room is a
temporary shared space. Only the host, by an explicit action, moves something from one to
the other.

---

## 10. Room lifetime, quota, and deletion

### The host sets the expiry

There is no open-ended option. The host must choose when the room ends, at creation, and
the value is required rather than defaulted. An unbounded room is a permanent record of who
said what, which is the thing this feature is designed not to be.

| Option | Behaviour |
| --- | --- |
| Short | 1 hour, from creation. |
| Working session | 24 hours. |
| Extended | 7 days. |
| Custom | Any date the host picks. |

### Two rooms per host per month

A host account may hold at most **two active rooms in a rolling calendar month**. This is
the product constraint that decides what gets built later, so it is part of the data model
rather than a UI limit.

The quota is counted over a rolling month, keyed on the host, counting rooms that are
neither closed nor expired. It is enforced in the API route that creates a room, not in the
form, so it cannot be bypassed by calling the endpoint directly.

This is the intended shape: the free tier is enough to try a real meeting, and hitting the
wall is the moment a host understands the paid tier exists. The alternative, an unlimited
free tier, would let one account hold every transcript the service ever stores for free.

### Closing a room deletes it

Closing a room removes it immediately, cascading to messages, members, ideas, and votes. It
is not a soft delete and not a read filter, because a room that can no longer be read is
still a stored record of who said what, and that is exactly what the host asked to avoid by
choosing a bounded lifetime.

Deletion is not recoverable. The UI states this before the confirm, and offers an export
first, so "close" and "discard my transcript" are never the same click by accident.

A host who wants the transcript afterwards exports it as an encrypted JSON file through the
same download helper the rest of the app uses, before closing.

### Quota and expiry interact

A room that expires is deleted and its slot returns to the quota. A room that is closed
early is also deleted and its slot returns immediately, so a host who wants a third room
this month can close one rather than waiting.

### The paid tier

The two-room limit is the seam where a larger tier attaches. A paid host buys more concurrent
rooms and a longer maximum lifetime; nothing about the data model changes, because the
limit is already a number keyed on the host rather than a hard-coded rule in the UI.

---

## 11. Implementation phases

Each phase is independently useful and independently shippable. No phase modifies
`/chat`, the private conversation type, or any existing table.

| # | Phase | Delivers | Exit criteria |
| --- | --- | --- | --- |
| 0 | Room crypto | `lib/rooms/crypto.ts`: room key generation, wrapping, AES-256-GCM over the existing `lib/arweave/encryption` | Round trip; wrong key fails; tampered ciphertext fails; a fresh IV per message |
| 1 | Schema and RLS | `supabase/rooms.sql`, generated, folded into the bootstrap; `types/room.ts` | A non-member reads nothing; a guest cannot post in a read-only room; only the host can pin or kick |
| 2 | Create and join | `/rooms/new`, `/r/[roomId]`, link and invite code, host code shown once | A wrong invite code is rejected; an expired room is rejected; a leaked invite without the room key yields ciphertext only |
| 3 | Live transcript | Realtime channel, presence, replies, threads, pinning | Two clients converge on the same order; presence drops when a client disconnects |
| 4 | The model in the room | `lib/rooms/ai-bridge.ts`, the two key modes, the disclosure, key deletion | **The request body contains no data from outside the room**, asserted by test; the model answers only when invoked; a guest cannot invoke it |
| 5 | Roles | Promotion to `trusted`, read-only mode, per-room spend visibility | A promoted member is told before their first invocation; the host sees total spend per room |
| 6 | Brainstorming | Ideas, voting, idea to task, stage summaries, approved decisions, export | One vote per person per idea; a converted idea creates a real task; an approved decision appears in `/memory` |

### Testing notes

The security-relevant tests are the ones worth writing carefully:

- **Phase 0.** Every failure mode must fail closed. A decryption error must never return
  partial plaintext.
- **Phase 2.** Simulate a full leak: the room id, the invite code, the wrapped key, and
  every row in the database. Assert that no message is readable. This is the test that
  proves section 3's claim.
- **Phase 4.** Build a request for a room that exists next to a host who has private
  conversations with overlapping keywords, and assert none of that private text appears in
  the request. Keyword overlap is what makes this test meaningful rather than decorative.
- **Phase 4.** Assert the AI cannot be invoked by a `guest`, and that a `trusted` member's
  invocation is counted against the host.

### The order matters in one place

Phase 4 is the first phase where anything about the host can reach a third party, so it is
also the first phase that could expose them. Everything before it is inert: an empty
encrypted room leaks nothing regardless of how the access control is wrong.

---

## 12. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A guest burns the host's quota | Medium if `trusted` is granted freely | Promotion is explicit; per-room and per-member spend is shown to the host; AI invocations are rate limited per room |
| The AI answers with private host information | Low, and structurally prevented | The model never receives the host's private data; asserted by test in phase 4 |
| A leaked invite code is brute-forced | Low | Invite code has enough entropy to resist guessing, joins are rate limited per room, and a correct code alone still yields only ciphertext without the room key |
| A guest turns the room into a spam channel | Medium | Per-member insert rate limit; the host can switch to read-only or remove a member, effective immediately |
| A room is used to store harmful content | Medium | Transcript is encrypted and ephemeral by default; the host sets the lifetime; the app does not moderate content it cannot read, and says so plainly |
| The stored key is compromised | Low, and bounded | Encrypted at rest, separately expirable, deletable from Settings; disclosure before it is stored; deleting it degrades rooms to browser-only rather than breaking them |
| Room ids are enumerated | Low | Random non-sequential ids; rate limited joins; ids alone grant nothing |
| A provider logs the room transcript | Outside our control | Disclosed to participants that the model's provider receives what is said in the room; the host's private conversations are never part of that request |

The last row is the honest limit of this design. Encryption protects the transcript in
transit and at rest in our database. Once the model is invoked, the transcript reaches the
provider the host chose, under that provider's own policy. No architecture changes that, and
the UI says so rather than implying the room is sealed end to end in a way it is not.

---

## 13. Trade-offs accepted

| Choice | What it costs | Why |
| --- | --- | --- |
| Server storage rather than peer-to-peer | A small storage cost | WebRTC adds signalling, TURN, and NAT traversal to a system that already needs a server for presence and a key holder for the model. |
| The model reads only the room | It cannot use the host's history, so it knows less than the host | The host asked for this explicitly, and it is the only version that cannot leak |
| No AI key means no room | A host without a key cannot open one | Otherwise the feature is a group chat, and the value is the model |
| Guests need no account | No durable identity for a guest | Collecting one would put personal data in a room designed to collect none |
| A panel room is a separate room kind, not a change to this one | Two room types to maintain | Registered members bringing their own models would otherwise dilute the row above. See `docs/panel-rooms-proposal.md`. |
| Rooms expire | No permanent archive unless exported | A memory system that stores everything eventually stores noise; the ledger is for decisions, not conversations |
| Phase 4 before phase 5 | Roles arrive after the model works | A model that no one can invoke is inert, so the risk is in phase 4, not phase 5 |

the same download helper the rest of the app uses.



---

## 14. Settled decisions

These were open during the design and are now decided. They are recorded here rather than
left as questions so that a later change to one of them is visibly a change, and not a
discovery.

1. **Read-only is room-wide.** The host switches the whole room to read-only rather than
   individual members. Per-member permissions are already carried by the role, and adding a
   second axis on top of it would double the combinations to reason about for no case the
   host asked for.
2. **Every guest gives a display name, and it is required by default.** The requirement
   applies to guests joining the room, not to the host, who is the room's owner and does not
   choose a name for themselves. A room where everyone is "Guest 4f2" cannot be moderated or
   followed, and a brainstorming session needs to know who argued what. Each guest's name is
   encrypted inside their own message payload and never written to a column in the clear, so
   the server cannot read it while still being able to enforce that one was supplied. The
   host may relax the requirement for a room where anonymity is wanted.
3. **Summarising is a host button, not an automatic step.** The host presses "Summarise
   this stage" and the model produces the summary on demand, which is the only way a summary
   is ever created. Nothing is summarised unless the host asks, because every automatic
   summary is a call charged to the host's key for output nobody asked to read. A trusted
   member who wants a summary asks the host for it.
4. **Approved decisions are summarised before they are stored.** The approval step produces
   a summary of the decision and its reasoning; only then is it written to the host's ledger.
   This keeps the ledger free of the raw discussion, which is the room's job, and it costs
   nothing extra because the summary is produced from the same model call that presents the
   decision for approval.
5. **The host sets the key expiry, and "forever" is not offered.** A server-side credential
   with no expiry is the wrong default, so Option B is refused without a chosen date. The
   stored key is deleted on that date; the rooms that used it fall back to Option A behaviour
   rather than breaking.
6. **Closing a room deletes it immediately, and each host gets two rooms per month.** See
   section 10. The quota is the constraint that makes a paid tier possible later, and the
   immediate deletion is what keeps a two-room limit from feeling punitive.

### What is still open

- Whether a guest who leaves a room may rejoin with the same member token or is issued a
  new one. Default: a new one, so a rejoin is indistinguishable from a new participant for
  the purposes of the vote quota.
- Whether the two-room quota is per host account or per host per room topic. Default: per
  account, because the cost that motivates it is storage and key use, not subject matter.

---

## 15. Related files

```text
docs/group-rooms-design.md          this document
docs/panel-rooms-proposal.md        agreed next direction; not started
supabase/rooms.sql                   generated, folded into bootstrap-production.sql
src/types/room.ts                    room, member, message, idea types
src/lib/rooms/crypto.ts              room key, wrapping, message encryption
src/lib/rooms/ai-bridge.ts           builds a model request from the room only
src/lib/rooms/access.ts              member token, role resolution
src/components/rooms/room-create.tsx creation form and the key-mode disclosure
src/components/rooms/room-view.tsx   transcript, presence, the ask-the-model action
src/components/rooms/idea-board.tsx  ideas, voting, conversion
src/app/rooms/new/page.tsx
src/app/r/[roomId]/page.tsx
```

`lib/rooms/ai-bridge.ts` deliberately imports nothing from `lib/memory`, `lib/storage`, or
`hooks/use-conversations`. The test in phase 4 checks that, so the constraint survives a
future change that would otherwise be reasonable to someone in a hurry.


15. **Spend is reported as calls, not money.** The host sees how many model invocations the
    room has made, by whom, and which model answered. It is not shown a currency figure,
    because the server cannot know one: what a call costs depends on the host's provider
    contract and on token counts the provider alone measures. A panel that printed a price
    would be printing a guess, and a host budgeting from a guess would be misled by it. The
    limit this leaves is stated in the UI rather than papered over.
16. **The host is exempt from read-only.** The switch locks guests out of writing; it does not
    lock the host out of their own room. A room the host can read but not close is not what
    "read-only" is meant to mean.
17. **Only the host sees spend.** A `trusted` member may spend the host's key but does not get
    a view of the total. Making the host's bill legible to the people drawing it down is the
    opposite of what the trust grant is for, and it would turn a quiet limit into a social
    contest.