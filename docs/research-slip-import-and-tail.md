# Slip import and tail: feasibility (2026-11-02)

Research summary for the "link your sportsbook" ask. Full sources at the bottom.

| Capability | Feasible | Effort | Depends on | Risk |
| --- | --- | --- | --- | --- |
| Paste a share link (FD/DK/PrizePicks...) | Partly: share pages are JS shells; the og:image preview is the only reliable artifact, fed to the existing screenshot parser | S | nothing | low |
| Kalshi account link via user API key | Yes: official signed API, positions/orders readable | M | user makes a key; store server-side encrypted | low |
| FanDuel/DK auto-import (SharpSports, Juice Reel OAuth) | Technically yes; no sportsbook offers an API | M-L | SharpSports ~$500/mo; manual refresh 1-2x/day; 2FA friction | medium-high (DK ToS bans third-party access) |
| One-tap tail v1: open the book's event page | Yes | S | book event id from Propfein | low |
| One-tap tail v2: pre-filled parlay slip | FanDuel documented (`addToBetslip?marketId&selectionId`), DK undocumented (`?outcomes=sid+sid`, breaks when lines move) | M | per-outcome book ids (sids) from Propfein, refreshed on line moves | low-medium |
| Auto-place the bet | No. Banned by every book's ToS and by regulators (KYC, geolocation, RG controls are per session) | n/a | n/a | prohibited |

Order: share-link paste -> tail v1 deep links -> Kalshi key linking -> tail v2 (FanDuel first) -> account sync only once revenue covers a vendor.

Propfein needs to expose, per outcome and per book: event id, market id, selection id, a ready link, and a timestamp so Last Leg can warn "line moved since".

Sources: the-odds-api.com/releases/deep-links.html; actionnetwork.com (QuickSlip, BetSync explainer); docs.sharpsports.io (quickstart, book compatibility, 2fa-handling); juicereel.com/api-docs; docs.kalshi.com quick start; github.com/DeVig-AI/AI-Bettor-Model/pull/118; support.draftkings.com "can someone make bets for me"; support.fanduel.com "place a bet for someone else"; developer.apple.com review guidelines 5.1.1; vantegris.com US affiliate licence by state.
