# Hub

One small Node server (no dependencies) for the browser build's online features:

- **Chat** (`web/chat-app.js`, in the launcher and in game with Shift+Tab): text channels by category, replies, edits,
  deletions, emoji reactions, typing, @mentions, pictures (`POST /chat/upload`, signed-in players, resized by the page,
  4 MB) and private messages between accounts. Everything is kept in `WS_CACHE/chat` as append-only files; edits, deletions
  and reactions are appended marks that reading applies (`hub/chat-store.mjs`).
- **Friends and presence** (`hub/social.mjs`): requests, friends and blocks per account; who is online, their status
  (online, idle, do not disturb, invisible) and what they are doing (in the launcher, in a menu, on a map).
- **Profiles** (`hub/profiles.mjs`): display name, picture, banner, name colour, pronouns, about me, custom status and links
  (`GET /profile/<user>`, `GET /profiles?u=…`, `PUT /profile`, `PUT /profile/image?kind=avatar|banner`).
- **Cloud files** (`hub/cloud.mjs`): each account's saves, dupes, `data/`, game settings, demos and screenshots, so they
  follow the player (`web/cloud-sync.js`); `CLOUD_QUOTA_MB` per account (512).
- **Shared saves** (`hub/shares.mjs`): a save and its picture under a short code (`?save=<code>` links), and the community
  list shown on the game's Saves page.
- **Lobbies and pairing** for peer-to-peer games (`web/lobby.js`): hosts list their game, joiners click it, and the two pages
  swap WebRTC pairing codes through the hub. Game traffic never passes through it.
- **Shared game versions** (`hub/versions.mjs`): a custom version's edition and Workshop addon list under a short code.
- **Workshop** (`hub/workshop.mjs`): browse Garry's Mod Workshop items and fetch their `.gma` files. The browser cannot do
  this against Steam itself (no CORS, and most items have no direct download link). Files come from
  [DepotDownloader](https://github.com/SteamRE/DepotDownloader)'s anonymous login and are cached on disk.
- **Real servers** (`hub/servers.mjs`): Steam's server list for Garry's Mod (`GET /servers`, needs `STEAM_KEY`), with each
  server asked for A2S_INFO from the hub for its details and ping, and a UDP relay (WebSocket `/udp`) so the browser can
  play on them. The relay only reaches addresses known to be Garry's Mod servers and caps each connection at 1 MB/s.
- **Paired relay** (`/pair`): carries a peer-to-peer game's traffic between two players whose browsers cannot reach each
  other directly.
- **Steam sign-in** (`hub/steam-login.mjs`, optional): a player approves a QR login in the Steam mobile app; the hub keeps
  the refresh token encrypted with a key only that player's browser holds, and while they play it stays logged on to Steam
  for them and hands the game real login tickets, which regular Garry's Mod servers require. This is the only part that
  needs packages (`steam-session`, `steam-user`, `qrcode`: `npm install` in `hub/`); without them the rest runs as before.

- **Admin panel** (`hub/admin.mjs`, `web/admin.js`): for accounts in `ADMIN_USERS` (default `neutro74`), unlocked with an
  authenticator-app code. Bans and mutes by browser id, address and/or account; kick; delete or clear chat; announcements;
  close games; sign accounts out everywhere; hub status, log and restart; an audit log of every admin action; and a terminal
  on the Pi (`hub/term-pty.py` runs `ssh ADMIN_SSH_TARGET` in a pty with the hub's own key, which `authorized_keys` only
  accepts from 127.0.0.1). The authenticator is enrolled on the Pi, so a stolen password alone cannot enroll one:
  `sudo -u gmodhub env WS_CACHE=/var/lib/gmod-hub node /opt/gmod-hub/admin.mjs enroll <user> [--force]` prints the
  `otpauth://` link to scan.

## Running it

```
PORT=8787 node hub/hub.mjs
```

| Variable | Meaning |
| --- | --- |
| `PORT`, `HOST` | Listen address (default `0.0.0.0:8787`). |
| `TRUST_PROXY=1` | Take the client address from `CF-Connecting-IP` / `X-Forwarded-For` (behind a tunnel or proxy). |
| `ORIGINS` | Comma-separated page origins allowed to connect (empty: any). |
| `STEAM_KEY` | Steam Web API key; needed only for Workshop browsing and search (item details and downloads work without). |
| `WS_CACHE` | Directory for downloaded `.gma` files (default `./ws-cache`). |
| `DEPOT_DOWNLOADER` | Path to the DepotDownloader binary. |
| `ADMIN_USERS`, `ADMIN_SSH_TARGET` | Admin accounts (default `neutro74`) and where the admin terminal connects (default `davidc@127.0.0.1`). |
| `CLOUD_QUOTA_MB` | Cloud space per account for game files (default 512). |
| `WS_MAX_ITEM`, `WS_MAX_CACHE`, `WS_MAX_AGE_DAYS`, `WS_PER_IP_HOUR` | Largest item (8 GB), cache size (30 GB), days an unused file is kept (7), downloads per address per hour (30). |

The page finds the hub from `?hub=wss://…` (remembered), else `HUB_DEFAULT` in `web/hub.js`.

## The Raspberry Pi deployment

`gmod-hub.service` runs it as user `gmodhub` with its cache in `/var/lib/gmod-hub`; the Steam key goes in
`/etc/gmod-hub.env` (`STEAM_KEY=...`, mode 600). Tailscale Funnel gives it a public HTTPS/WSS address:

```
sudo install -m 644 hub/*.mjs hub/term-pty.py /opt/gmod-hub/
(cd hub && npm install --omit=dev) && sudo cp -r hub/node_modules hub/package.json /opt/gmod-hub/   # Steam sign-in only
sudo install -m 644 hub/gmod-hub.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart gmod-hub
sudo tailscale funnel --bg 8787
```

DepotDownloader's `linux-arm64` release is unpacked in `/opt/depotdownloader`.
