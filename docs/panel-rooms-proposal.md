# Proposal — panel rooms, hosted models, and the cost of a room

A written record of a direction discussed after phase 3 was completed. **No code here.**
It exists so the reasoning survives past the conversation it happened in, and so the
decisions below are argued from the file rather than from memory.

Status: agreed, not started. Phase 6 (ideas, voting) is deferred until this is either built
or explicitly dropped.

---

## 1. Why this document exists

The room design treats a room as a temporary shared space that collects no personal data.
That promise is what makes it safe to hand a link to strangers, and section 13 of
`group-rooms-design.md` states the trade-off explicitly:

> `| Guests need no account | No durable identity for a guest | Collecting one would put personal data in a room designed to collect none |`

Two things were proposed that would each weaken that promise. The reason for writing this
down is not the features. It is that **both features are only safe because they are separate
room kinds**, and that separation is the whole design.

If either is bolted onto the existing room instead, the promise in section 13 becomes false.

---

## 2. What was proposed

| # | Proposal |
| --- | --- |
| 1 | The host may host registered accounts, each bringing their own model for the session. |
| 2 | A room of several models rather than one, with each model given a named speciality. |
| 3 | The program itself provides open-source models, as a subscription feature, for both room kinds. |
| 4 | Rooms become a paid feature rather than free. |

---

## 3. Decisions

| Decision | Value | Why |
| --- | --- | --- |
| Two room kinds | `guest` (existing) and `panel` (new) | Keeps the existing promise intact instead of diluting it. |
| Who enters a panel room | **Registered accounts only.** No anonymous members. | An anonymous member bringing a model reintroduces exactly the identity problem section 13 avoided. |
| Whose key pays | **Each member's own.** Never anyone else's. | Removes the cost-abuse surface in both directions. |
| Whose model | Each member's own, **optional**. | A room with no models is an ordinary brainstorm room. |
| Specialities | **Defined by the host.** A member picks one from the host's list. | A random speciality is noise; a chosen one is a panel. |
| The cap | **Set by the host.** | The host bounds the exposure, as they do everywhere else. |
| Public-key delivery of the room key | Deferred. | A registered member needs identity, not a different key-delivery path. |
| Subscription credits and hosted inference | Deferred. | Not designed yet. The schema should reserve a slot for it. |

---

## 4. The problem this solves, and one that already exists

### 4.1 A live cost gap

`src/app/api/rooms/ai/route.ts` resolves the key without asking *who* is calling:

```ts
if (request.headers.get(HEADER_OPENROUTER_KEY)?.trim()) {
  return resolveRequestAuth(request);          // caller's own key
}
const stored = await loadHostKey(access.roomOwnerId);   // host's key, for anyone
```

A `trusted` member who has no key of their own gets the **host's stored key** (Option B). The
host pays for that member's questions. That is the intended behaviour of Option B, but Option
B was consented to by the *host* for the room's own operation, not for other members' use.

There is a second gap in the other direction: a member who *does* send their own key still
gets the **room's** model, because

```ts
const model = access.aiModel?.trim() ?? "";   // room row, never the request
```

so they pay for a model they never chose.

### 4.2 Why neither is fixed in place

Both gaps disappear in a panel room, and neither can be fixed without one. Making the payer
choose their own model would change the guest room's guarantee that *"the host's own key,
always"*; banning Option B for members would weaken a mode the host deliberately chose.

Separating the room kinds keeps the existing room untouched and makes the panel room's rule
absolute instead of compromised.

---

## 5. The rule, stated once

> **No one spends someone else's key. Whoever invokes a model invokes it with their own.**

In a panel room this has no fallback. There is no stored key to fall back to, so a member
with no model simply cannot invoke one. That is the correct outcome, not a gap to be filled
later with a shared credential.

---

## 6. Data model

```sql
-- Which kind of room this is.
rooms.room_kind text not null default 'guest'
       check (room_kind in ('guest', 'panel'))

-- Host-defined specialities and the cap, both meaningful only for a panel room.
rooms.ai_specialties  jsonb
rooms.ai_max_models   integer check (ai_max_models is null or ai_max_models > 0)

-- A panel member is an account. A guest member is not.
room_members.user_id uuid references auth.users(id) on delete cascade

-- The model a member brought, if they chose to bring one.
room_members.model_id         text
room_members.model_label      text
room_members.model_specialty  text

-- Which model spoke an answer. Absent on every guest-room message.
room_messages.model_label      text
room_messages.model_specialty  text
```

A panel room's member row carries a constraint the guest room's does not:

```sql
check (room_kind = 'guest' or user_id is not null)
```

which cannot live on `room_members` directly because the kind lives on `rooms`. It is
enforced by the join route instead, and asserted by test.

### 6.1 Speciality, in a concrete example

```text
The host defines:  ["نقد وتصحيح", "تسويق", "شرح وتوضيح"]
The host sets:      cap 5

Sarah:  GPT-4o   -> "نقد وتصحيح"
Khalid: Llama 3  -> "تسويق"
Reem:   (did not bring one)
```

Reem's absence is not an error. A member who does not want to spend their key on a debate is
not failing to participate.

---

## 7. Work, in order

### Phase A — attribution and specialities

Useful to the guest room immediately, and a prerequisite for the panel room: without
attribution, several models produce several unattributed answers, which is noise.

| File | Change |
| --- | --- |
| `supabase/rooms.sql` | the two `rooms` columns, the two `room_messages` columns |
| `src/lib/rooms/ai-bridge.ts` | name and speciality inside the `assistant` turn |
| `src/app/r/[roomId]/page.tsx` | pick a speciality; render it on every answer |

No keys, no accounts, no change to authorisation. The riskiest part is the SQL, because
`bootstrap-production.sql` must embed it verbatim.

### Phase B — the panel room

| File | Change |
| --- | --- |
| `supabase/rooms.sql` | `room_kind`, `user_id`, the three model columns |
| `src/app/api/rooms/join/route.ts` | refuse `panel` without a session |
| `src/app/api/rooms/panel/route.ts` | register and withdraw **the caller's own** model |
| `src/app/api/rooms/ai/route.ts` | the `panel` branch |

The `panel` branch of the AI route is the heart of this document:

```ts
if (roomKind === "panel") {
  // The model is the caller's own registration, not the room row.
  if (!callerModel) return refusal;
  // The key is the caller's. No stored-key fallback exists in this branch,
  // and adding one later would break section 5.
}
```

### Phase C — subscription and hosted models (deferred)

Deferred, but the schema should reserve its slot now:

```sql
room_messages.ai_provided_by text   -- 'byok' | 'subscription'
```

so that later, a call drawn from a subscription allowance is distinguishable from a call a
member paid for themselves. Retrofitting that onto existing rows is not possible.

---

## 8. Tests to write

| File | What it pins |
| --- | --- |
| `panel-route.test.ts` | a `panel` room refuses an anonymous joiner; the model comes from the caller, never the room row |
| `panel-auth.test.ts` | **no one spends someone else's key** — the most important test in this document |
| `attribution.test.ts` | an answer carries its model and speciality |
| `ai-bridge.test.ts` | the existing isolation test still passes unchanged |

That last row is the one that matters most. `ai-bridge.ts` is the import wall that keeps
section 1 true, and `ai-bridge.test.ts` fails loudly if anything outside the room is ever
reached for. Phase A must not be allowed to make it pass by being deleted.

---

## 9. Cost, stated honestly

The free tier stays BYOK and costs the host nothing. A subscription that provides hosted
inference does not:

- Inference is charged per token by whoever runs the GPU. Supabase and Vercel host the
  application; they do not host the model. "Nearly zero server cost" is true of the app and
  false of the inference.
- A cap on *how many models* a subscriber may choose bounds choice, not spend. It does not
  bound cost at all.
- What bounds cost is an allowance: messages, tokens, or credits.

Therefore: **"rooms never touch the free tier"** (`group-rooms-design.md`, phase 4) survives
as long as a hosted model is never offered inside a room the host did not pay for. Whether
subscription inference may appear in rooms at all is **not yet decided**, and is the open
question of this document.

---

## 10. Privacy: what may be claimed

Open-source models alone do **not** prevent training on prompts. A model routed to a host
that logs is logged whatever its weights are.

What does guarantee it is routing:

- OpenRouter's **ZDR** documents that *"providers that do not retain your data are also
  unable to train on your data."*
- ZDR can be enforced **per request** (`provider.zdr`), per model group, or per account, and
  the eligible endpoints are readable at `https://openrouter.ai/api/v1/endpoints/zdr`.
- OpenRouter states its own prompts are not retained unless prompt logging is enabled.
- Self-hosting, already partly present via Ollama, is the strongest claim available.

So the defensible claim is **"routed only to endpoints that do not retain your data"**, which
is verifiable and enforceable, rather than **"we use open-source models"**, which a competitor
can say without doing anything.

### 10.1 One caveat that must not be forgotten

> ZDR enforcement applies to inference routing. It does not apply to plugins and tools such
> as web search, which have their own retention policies.

A room that advertises ZDR must have web search off. Otherwise the promise is false.

---

## 11. What was considered and rejected

| Option | Why not |
| --- | --- |
| Caller chooses any model, free choice | Lets any member bill the host for a price nobody agreed to. This is why the host defines the specialities and the cap. |
| Public-key delivery of the room key to registered members | Real work, no benefit yet. A registered member needs identity; key delivery already works through the invite code. |
| Banning Option B in the guest room | The host chose it deliberately for the room's own operation. Narrowing it would weaken a mode they picked. |
| Letting anonymous members bring a model | Reintroduces the identity problem section 13 exists to avoid. |
| Capping by number of models | Bounds choice, not spend. |

---

## 12. Open questions

- What allowance shape represents a subscription: messages, tokens, or credits?
- May subscription inference appear inside rooms at all, or only in private chat where the
  account is unambiguously the payer?
- Does a member's model registration survive leaving and rejoining?

---

## 13. Related files

```text
docs/panel-rooms-proposal.md       this document
docs/group-rooms-design.md         the room design these decisions extend
supabase/rooms.sql                 schema, folded into bootstrap-production.sql
src/lib/rooms/ai-bridge.ts         the import wall; must stay untouched
src/app/api/rooms/ai/route.ts      where the panel branch belongs
```