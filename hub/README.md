# Hub

One small Node server (no dependencies) for the browser build's online features:

- **Chat rooms** for the launcher (`web/hub.js`, `web/launcher.js`).
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
| `WS_MAX_ITEM`, `WS_MAX_CACHE`, `WS_MAX_AGE_DAYS`, `WS_PER_IP_HOUR` | Largest item (8 GB), cache size (30 GB), days an unused file is kept (7), downloads per address per hour (30). |

The page finds the hub from `?hub=wss://…` (remembered), else `HUB_DEFAULT` in `web/hub.js`.

## The Raspberry Pi deployment

`gmod-hub.service` runs it as user `gmodhub` with its cache in `/var/lib/gmod-hub`; the Steam key goes in
`/etc/gmod-hub.env` (`STEAM_KEY=...`, mode 600). Tailscale Funnel gives it a public HTTPS/WSS address:

```
sudo install -m 644 hub/*.mjs /opt/gmod-hub/
(cd hub && npm install --omit=dev) && sudo cp -r hub/node_modules hub/package.json /opt/gmod-hub/   # Steam sign-in only
sudo install -m 644 hub/gmod-hub.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart gmod-hub
sudo tailscale funnel --bg 8787
```

DepotDownloader's `linux-arm64` release is unpacked in `/opt/depotdownloader`.
