# Football Auction Platform — Architecture & Design Decisions

## 1. Overview

A real-time auction platform for a friend group's football team-picking session.
Two captains bid on players using a virtual currency ("Riyal Coins"). The rest of
the friend group can watch the auction live without logging in or signing up.

**Core challenge:** this is fundamentally a real-time, server-authoritative
concurrency problem (two captains can bid within milliseconds of each other),
not a CRUD app.

---

## 2. Tech Stack

- **Frontend:** Next.js (React) — pure frontend, no reliance on Next.js API
  routes or server runtime for real-time logic.
- **Real-time server:** Standalone Bun server using `Bun.serve()` with native
  WebSocket support. No Socket.io needed — this is a closed friend-group app,
  not public internet at scale, so we don't need fallback transports.
- **Database:** Prisma (already familiar from prior projects) — Postgres or
  SQLite is fine given the scale.
- **Language:** TypeScript throughout.

### Why not Next.js API routes for sockets?

Next.js routes are stateless/short-lived, especially on serverless platforms
like Vercel — they don't support long-lived WebSocket connections well. Keeping
Next.js as a pure frontend and running a separate Bun WebSocket server gives:

- Clean separation of concerns
- Deployability of the frontend anywhere (including Vercel)
- No fighting Next.js server-runtime quirks for stateful real-time logic

---

## 3. Core Principle: Server-Authoritative State

The client is a **display layer only**. It never trusts its own balance or
highest-bid values for validation — those live and are validated exclusively
on the server.

- Every bid is sent to the server for validation.
- Server broadcasts the *result*, not just an echo of the client's claim.
- Live auction state (current player, current highest bid/bidder) is held as
  an **in-memory object in the single Bun process** — no need for Redis
  pub/sub or distributed locks, since there's only one active auction room
  with one player on the block at a time, and a single server process.
- **No async yield mid-validation:** the bid-check-and-update logic must run
  synchronously (validate + update state before any `await`) to avoid a race
  where two bids interleave on the event loop.

### Bid validation rules (server-side, always)

1. `bid > currentHighestBid`
2. `bid <= captain.balance`
3. Auction status must be `bidding` (not `sold`, `paused`, etc.)

Invalid bids are rejected with an error event sent **only** to the offending
captain's socket — never broadcast.

---

## 4. Data Model (Prisma)

```
Player
  - id
  - name
  - position
  - basePrice
  - status: available | sold | skipped   (see §11 — "skipped" = permanently
    unsold after max passes; a plain unsold pass just requeues at the back
    and status stays "available")
  - passCount (number of times gone unsold, for the requeue cap)
  - soldPrice
  - soldToCaptainId (nullable)

Captain
  - id
  - name
  - balance (Riyal Coins)
  - sessionToken (for reconnect mapping)
  - players (relation → Player[])

Auction
  - id
  - roomCode (short random slug, not sequential)
  - status: upcoming | live | paused | done
  - currentPlayerId
  - currentHighestBid
  - currentHighestBidderId

BidLog
  - id
  - auctionId
  - captainId
  - playerId
  - amount
  - timestamp
```

**Persistence strategy:** live state lives in memory for speed; it is
checkpointed to the DB **after each sale** (not on every single bid — too
chatty). This means a server crash mid-bid loses at most the current
in-progress bid, not the whole auction history.

---

## 5. Roles

Three distinct participant types — designed in from day one so spectators
don't require retrofitting later:

| Role | Identity needed? | Can do |
|---|---|---|
| **Host/Admin** | Optional (see §8) | Start auction, advance to next player, undo a mistaken sale |
| **Captain** | Yes — lightweight token | Place bids |
| **Spectator** | None | Watch only, read-only |

### Enforcement

Auth is enforced **server-side at the socket-event-handler layer**, not just
hidden in the UI. Every state-changing event handler checks "does this socket
have a valid captain session?" before proceeding. This means:

- Hiding the bid button for spectators is cosmetic only — the real gate is
  server-side.
- A curious friend opening dev tools and firing a `bid:place` event as a
  spectator gets rejected regardless of what the UI shows.

---

## 6. Auth Strategy

Kept intentionally minimal — this is a friend-circle app, not a public product.

- **No accounts, no signup/login for anyone.**
- **Captains:** join via room code, pick a name/avatar, receive a signed
  token (cookie or localStorage) that maps their socket back to their
  Captain record on reconnect. This is required because a captain's
  balance/team must persist across accidental disconnects (e.g. mobile
  tab switches killing the WS connection).
- **Spectators:** just open a public watch link —
  `yourapp.com/watch/<roomCode>` — no identity at all, no token needed,
  since there's nothing to persist per-spectator.
- **Room code:** short random slug (not `room1`, `room2`, ...) so a link
  posted in a WhatsApp group can't be casually guessed into. Stakes are low
  (virtual coins) but this is free to get right.

---

## 7. Real-Time Event Design

Keep the event surface small and broadcast-oriented.

| Event | Direction | Notes |
|---|---|---|
| `auction:player-on-block` | Server → all | New player up for bidding |
| `bid:place` | Captain → Server | Only accepted from valid captain sockets |
| `bid:accepted` | Server → sender only | Confirms a valid bid |
| `bid:rejected` | Server → sender only | Never broadcast — avoids embarrassing the bidder publicly |
| `bid:update` | Server → all | New highest bid, broadcast to captains + spectators |
| `player:sold` | Server → all | Final result; triggers balance deduction + DB checkpoint |
| `auction:next` | Host → Server | Advances to next player |

### Fan-out model

Server keeps a `Map`/`Set` of connected sockets tagged with `{ role, roomId }`.
On any state change, iterate over all sockets in that room and emit — captains
and spectators receive the same public broadcasts; captains additionally get
private events like `bid:rejected`.

---

## 8. Host Role — Open Decision

Two options, pick based on how you'll actually run the session:

1. **Host = you, running it from your own machine.** No token/reconnect-safety
   needed — if your connection drops, you just refresh. Simplest to build.
2. **Host = a token-holding role like captains**, with reconnect-safety.
   Needed if you want to hand off "run the auction" duties to someone else
   or want resilience against your own disconnects.

*(Default recommendation for v1: option 1 — skip host reconnect handling,
revisit only if it becomes annoying in practice.)*

---

## 9. Reconnection Handling (Captains)

Mobile browsers frequently drop WebSocket connections on tab switch — this
must be handled, not ignored:

- On disconnect: **do not delete captain state.** Mark them `away`, keep
  balance/team intact.
- Allow rejoin with their token within a reasonable window.
- On reconnect: **push a full state snapshot** (current player on block,
  current highest bid, their own balance) rather than relying on the client
  having received every missed event while disconnected.

---

## 10. Bid Timer

To make the auction feel real: a countdown (e.g. 10 seconds) resets on every
valid bid; when it expires with no new bid, the player is marked sold.

- **Must run server-side** (`setTimeout`, reset on every valid bid).
- Never trust a client-side timer for anything that ends in a state change
  (money/coins moving) — a client could pause its own tab's timer.

---

## 11. Auction State Machine

```
idle → player-on-block → bidding → sold
                              ↓
                           unsold → requeued to end of list → (next player)
```

- `idle`: auction not started yet
- `player-on-block`: new player announced, timer not yet running
- `bidding`: active bidding, timer running, resets on each valid bid
- `sold`: timer expired with a highest bidder → balance deducted, DB checkpoint
- `unsold`: timer expired with no bids → **player goes back into the queue at
  the end**, not removed — everyone else gets bid on first, then unsold
  players come back up for another round

### Player queue / requeue logic

- The server holds an ordered **queue** of player IDs still to be auctioned
  (in-memory, checkpointed to DB alongside auction state).
- On `unsold`: pop the player from the front, push it to the **back** of the
  queue, move on to the next player immediately.
- On `sold`: pop the player from the front, remove it from the queue
  permanently (it's done).
- Auction only reaches `done` when the queue is empty.
- **Edge case to handle:** if a player goes unsold on every single pass (no
  captain ever bids), you'll get an infinite loop unless you cap it — e.g.
  track an `unsoldRounds` count per player and mark them permanently
  `unsold`/skipped after N passes (configurable, e.g. after 2 full loops)
  rather than requeuing forever.
- This also means `Auction.currentPlayerId` should really be thought of as
  "front of queue," and the `Player.status` enum needs a rule: `unsold` is a
  *transient* state (back in queue) vs. a final `unsold` state (permanently
  skipped after max passes) — worth distinguishing these two in the schema,
  e.g. `status: available | sold | skipped` plus a separate `passCount` field,
  rather than overloading `unsold` to mean both.

---

## 12. Suggested Build Order

1. Bun WebSocket server with in-memory auction state + state machine
2. Prisma schema + DB checkpointing after each sale
3. Captain join flow (room code → token → socket auth)
4. Bid placement + server-side validation + broadcast
5. Server-side bid timer
6. Spectator watch link (read-only socket join, no auth)
7. Reconnection handling for captains (state snapshot on rejoin)
8. Host controls (start / next player / undo sale)
9. Polish: live spectator count, sold/unsold animations, final team recap screen

---

## 13. Explicit Non-Goals (v1)

- No real accounts/signup for anyone
- No horizontal scaling / multi-room support beyond one active auction at a
  time (no Redis pub/sub needed)
- No real-money handling — Riyal Coins are virtual and stakes are purely
  social/for fun