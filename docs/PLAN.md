# CallNChat — Complete Development Plan

## Context

Private messenger for exactly **2 users, both on iPhone**. WhatsApp-like UI/UX. Features: chat, voice/video calls, photos, docs, voice notes, location (pin + live). Constraints agreed in discussion:

- **No owned server, no domain, $0** for v1.
- Users connect by **sharing a secret pairing string** (or QR).
- **Calls only when both apps are open**; presence shows 🟢 Online / ⚪ Last seen. "Phone off" is undetectable — only "not heard from".
- Optional final phase: push-to-ring a closed app (requires $99/yr Apple Developer Program).

Phase 0 scaffold lives on this repo; see README for commands.

## Locked architecture

```
React Native (Expo SDK latest, dev client + prebuild, TypeScript strict, Hermes, New Arch)
├─ UI: expo-router, FlashList, Reanimated, Gesture Handler, keyboard-controller, expo-image
├─ State: zustand  │  DB: op-sqlite + SQLCipher (DB key in Keychain via expo-secure-store)
├─ Crypto: @noble/curves, @noble/hashes, @noble/ciphers (audited, pure JS) + react-native-get-random-values
├─ Rendezvous + offline mailbox: Nostr (nostr-tools) — NIP-44 encryption, NIP-59 gift wrap, 3–5 public relays in parallel
├─ Live link (Phase 4/5): react-native-webrtc — files and calls only; chat stays on Nostr (decided in Phase 2)
├─ Calls: separate RTCPeerConnection per call (audio/video), react-native-incall-manager for audio routing
└─ NAT: STUN (Cloudflare + Google, free) → optional TURN creds entered once in Settings
```

Key simplifications (deliberate):

- **No Hyperswarm/Bare** — one networking stack (WebRTC).
- **No PAKE** — pairing string carries 32 random bytes (high entropy), so offline brute force is infeasible.
- **No hand-rolled Double Ratchet** — live traffic gets forward secrecy from WebRTC DTLS (ephemeral ECDHE); SDP/DTLS fingerprints are signed by pinned identity keys → MITM-proof. Mailbox messages use NIP-44 with **rotating mailbox keys** (new key every 24h, exchanged over live link, old keys deleted) for coarse forward secrecy.

## Repo layout

```
src/app/                  expo-router screens: (onboarding)/, chat/, call/, settings/, media/
src/core/crypto/          identity, pairing codec, signing, mailbox key rotation
src/core/nostr/           RelayPool, gift-wrap send/receive, presence heartbeats
src/core/rtc/             PeerLink (DataChannel lifecycle, reconnect), CallSession
src/core/protocol/        frame types (zod schemas), encoder/decoder, dedupe by ULID
src/core/transfer/        chunked file send/receive, SHA-256 verify, resume
src/data/                 SQLCipher schema, migrations, repositories
src/features/             chat, media, location, calls, presence, settings (hooks + components)
src/ui/                   WhatsApp-style design system (bubbles, ticks, headers, theme light/dark)
test/node-harness/        two headless peers (nostr-tools + @roamhq/wrtc) for integration tests
.github/workflows/        ci.yml (Linux: lint/typecheck/jest/harness)
.eas/build/               ios-unsigned.yml (EAS custom build: unsigned IPA)
```

## Protocol essentials

- **Identity**: secp256k1 keypair per install (Nostr key), stored in Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- **Pairing code** (Phase 1, implemented): `cnc1…` bech32m of version | x-only pubkey | 32-byte secret (checksum
  catches typos). Shown as text + QR. Both users add **each other's** code, so each side derives the same pair
  secret offline: HKDF-SHA256(sorted secrets, salt = sorted pubkeys). Keys pinned; 6-emoji + 12-digit **safety
  code** (hash of both pubkeys) for an in-person check. Phase 2 confirms the pair secret over Nostr with an HMAC.
- **Presence**: ephemeral Nostr events (kind 2xxxx, not stored by relays), encrypted, every 20s while foreground; `bye` on background; timeout after 3 missed beats. Once DataChannel up, heartbeats every 5s over it.
- **Connection**: when both online, lower pubkey = offerer; SDP/ICE exchanged via gift-wrapped Nostr events, each signed by identity key and fingerprint-checked.
- **Frames** (DataChannel JSON, zod-validated): `msg, ack, read, typing, react, edit, delete, file-offer, file-chunk, file-ack, loc, loc-live, call-offer, call-answer, call-ice, call-end, mailbox-key`.
- **Delivery** (Phase 2, implemented): every text, receipt, presence and typing frame goes over Nostr. Durable
  frames = NIP-59 gift wraps (kind 1059, backdated ≤2 days, expire after 30 days); presence/typing = same seal in
  ephemeral kind 21059. Seal must be signed by the pinned peer. Outbox retries with backoff; dedupe by wrap id and
  message id. Ticks: ✓ sent (≥1 relay accepted), ✓✓ delivered, blue ✓✓ read. Own per-relay reconnect loop
  (nostr-tools' reconnect resumes from the last event time and would skip backdated wraps). Full files go over
  WebRTC in Phase 4.

## Phases (one developer; estimates are rough)

### Phase 0 — Foundation (≈3 days)

Expo scaffold, TS strict, ESLint/Prettier, Jest, expo-router skeleton, theme tokens, CI on Linux, EAS custom build producing unsigned IPA artifact.
**Done when**: CI green; IPA builds on EAS and installs via SideStore on a device.

### Phase 1 — Identity, pairing, secure storage (≈1 week)

Keychain identity, SQLCipher DB + migrations, pairing codec, QR show/scan (expo-camera), paste/share string, safety-code screen, app lock (Face ID via expo-local-authentication).
**Done when**: two devices (or harness peers) pair, pins persist across restarts, tampered string rejected.

### Phase 2 — Nostr messaging core (done)

Relay transport (per-relay subscriptions + own reconnect loop, NIP-42 AUTH), gift-wrap envelope with strict
unwrap, zod-validated frames, messenger (outbox with backoff, dedupe, delivered/read receipts, hello confirmation,
presence + typing), schema v2 (messages, seen events), basic chat screen.
**Verified**: two simulated phones over two local relays — offline delivery, delivered → read, presence and
typing, relays down → pending → delivered after restart, stranger wraps ignored. WebRTC PeerLink moved to
Phase 4/5. Mailbox key rotation still in Phase 6.

### Phase 3 — WhatsApp-style chat (≈2 weeks)

Chat header with presence, bubbles, ticks, typing indicator, date separators, swipe-to-reply, long-press menu (react, copy, edit, delete for both, forward-to-notes), emoji reactions, search, disappearing messages timer, unread counter, local notifications while app foreground only.
**Done when**: full chat flow works on two iPhones; 10k-message history scrolls smoothly.

### Phase 4 — Media, docs, voice notes, location (≈2 weeks)

expo-image-picker (photos/videos with compression), expo-document-picker, chunked transfer (16 KB chunks, backpressure via `bufferedAmountLowThreshold`, SHA-256 verify, resume), gallery viewer, voice notes (expo-audio record/playback, waveform), location pin + live location (expo-location, react-native-maps/Apple Maps, auto-expiry 15m/1h/8h).
**Done when**: 200 MB video transfers with resume after app background/foreground; live location updates on both sides.

### Phase 5 — Voice & video calls (≈2 weeks)

Call button enabled only when 🟢; in-app full-screen incoming call with ringtone/haptics, 30s timeout → missed call entry; audio↔video upgrade, mute, speaker/earpiece, camera flip, PiP-style local preview, connection quality indicator, call log in chat.
**Done when**: 30-min video call stable on Wi-Fi↔4G; network switch triggers ICE restart without dropping.

### Phase 6 — Hardening & polish (≈1–2 weeks)

Encrypted backup export/import (passphrase → Argon2id → file via share sheet), TURN settings + connectivity test, relay list editor, dark mode, accessibility, haptics, error/retry UX, crash-safe outbox, wipe/duress option, privacy screen in app switcher.
**Done when**: restore from backup on a fresh install recovers history and pairing.

### Phase 7 (optional, $99/yr) — Ring when app closed

Apple Developer Program → PushKit + CallKit (react-native-callkeep, react-native-voip-push-notification); APNs JWT signed on-device with dedicated revocable .p8 key; TestFlight distribution replaces SideStore.

**Total v1 (Phases 0–6): ≈10–12 weeks** [Guessing — single experienced RN dev].

## Build & distribution ($0 path)

- No Mac required: EAS Build free plan, profile `ios-unsigned` (`withoutCredentials`, custom steps in `.eas/build/ios-unsigned.yml`) → unsigned `.ipa` artifact → installed via **SideStore** with a free Apple ID on each iPhone; SideStore auto-refreshes the 7-day signature.
- EAS free plan: ~15 iOS builds/month on a low-priority queue [Likely]. Fallbacks: Codemagic (500 free macOS minutes/month), local Mac + Xcode personal team. GitHub Actions is unavailable while the account has an unpaid invoice.
- Expo Go cannot be used (native WebRTC) — always a dev-client build.

## Verification

1. `npm run lint && npm run typecheck && npm test` — unit tests for crypto, pairing codec, frame schemas, outbox, presence state machine.
2. `npm run test:harness` — two headless Node peers over real public Nostr relays + node WebRTC: pairing, presence, channel + mailbox delivery, file transfer with resume, call signaling. Runs in this Linux container and CI.
3. Device QA checklist per phase on both iPhones (Wi-Fi↔Wi-Fi, Wi-Fi↔cellular, cellular↔cellular, airplane-mode toggle, app background/kill).

## Known risks

- Both iPhones on carrier CGNAT may fail without TURN → Phase 6 TURN settings; measure in Phase 2.
- Public Nostr relays can rate-limit or drop events → publish to 3–5 relays, user-editable list.
- iOS suspends the app seconds after backgrounding → "online" means app on screen; accepted.
- SideStore free signing limits (7-day expiry, 3 sideloaded apps per Apple ID).
