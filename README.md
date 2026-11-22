# Soundbox Saathi — the next-gen Paytm Soundbox

> Soundbox tells you what you earned. Saathi protects it.

**Track:** Commerce & Payments

Full spec: see [SPEC.md](SPEC.md).

## Problem

Kirana merchants lose money every day to:
- **Fake payment screenshots** shown at the counter during rush hour
- **Unpaid udhaar** (credit) that is awkward to chase
- **Confusing settlements** — what came in, what was refunded, what's pending
- **Impersonation scams** — "Paytm support" messages asking for OTPs or refunds

## Features

- **Rush-hour "Bola vs Mila"** — matches the price the merchant said aloud against the payment actually received.
- **Fraud shield** — flags fake screenshots, duplicate refunds and scam messages.
- **Udhaar recovery** — tracks credit and sends a polite UPI payment reminder.
- **Fair, right-time credit** — offers credit when it's needed (e.g. Diwali stock-up) with the total cost spelled out and an affordability check.
- **Proactive closing hisab** — end-of-day summary spoken without being asked.
- **Owner-PIN lock** — the public sees only the last 3 payments; everything else needs the owner PIN.

## Safety design

- **AI never does math** — all numbers come from code tools, and a number-grounding check rejects any figure in a reply that the tools didn't produce.
- **Refunds are locked down** — no destination parameter, idempotent, and gated by a step-up PIN.
- **Shuffled PIN keypad** with a 3-strike lockout.
- **Untrusted forwarded text is treated as data**, never as instructions.
- **Honest fallback** — if a tool fails, Saathi says so instead of guessing.

## Architecture

- **Server:** Node/Express (`server.js`)
- **UI:** a single `public/index.html`
- **Agent:** Claude Haiku tool-use agent for off-script questions; a scripted golden path for the demo
- **Voice out:** Sarvam Bulbul v3 Hindi TTS, cached to disk (`cache/`)
- **Voice in:** Chrome speech recognition, push-to-talk

## Run

```bash
npm install
cp .env.example .env   # fill in SARVAM_API_KEY and ANTHROPIC_API_KEY
npm start
```

Open http://localhost:3000 in Chrome. Demo PIN: `1234`.

## Demo script

1. **Rush Hour** — Bola vs Mila matching
2. "**Aaya kya?**" — did the payment arrive?
3. "**Aaj kitna kamaya?**" — today's earnings (PIN-gated)
4. **Scam message** — forwarded "support" text flagged
5. **Udhaar** — reminder with UPI link
6. **Diwali credit** — total cost + affordability check
7. **Sahukar** — comparison against informal moneylender rates
8. **9 PM closing** — proactive closing prompt
9. **Hisab** — end-of-day summary
10. **Duplicate refund** — refund processed once
11. **Refund again** — blocked (idempotent)
