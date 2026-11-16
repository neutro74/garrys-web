<p align="center"><img src="web/brand/banner.png" alt="Garry's Web" width="100%"></p>

# Garry's Web

**Garry's Mod, running in your browser.** No install and no plugin: the retail game's 32-bit x86 DLLs are statically
recompiled to WebAssembly (`tools/lift/`) and run by a JavaScript host with a D3D9→WebGL renderer, a virtual filesystem,
Steam/Winsock shims, peer-to-peer multiplayer over WebRTC, and an online hub for chat, game versions, accounts and the
Workshop.

**Play:** each version is a [release](../../releases) with its link. The game is served from this repository's `cdn`
branch (one tag per version) through StaticDelivr.

| Launcher | Main menu | In game (gm_construct) |
| --- | --- | --- |
| ![Launcher](docs/screenshots/launcher.png) | ![Main menu](docs/screenshots/main-menu.png) | ![In game](docs/screenshots/in-game.png) |

## Layout

| Path | What it is |
| --- | --- |
| `tools/lift/` | x86 PE → Wasm recompiler (Python) and the Node runtime host (`host/`). See its README. |
| `runtime/`, `web/`, `ui/` | Browser host: launcher, workers, D3D9/GPU shims, input, storage, p2p |
| `ports/gmod/engine/` | Source engine fork (Emscripten/WebGL "ToGLES" work); see its `LICENSE` |
| `ports/gmod/compat/` | Compatibility layer, probes and tests |
| `hub/` | The online hub (chat, lobbies, accounts, shared game versions, Workshop downloads); see its README |
| `tools/` | Packaging (`package-web.mjs`, `package-cdn.mjs`), benchmarks, browser tests |
| `tools/brand/` | Garry's Web artwork: `node tools/brand/render.mjs` writes `web/brand/` |
| `docs/` | Performance notes and runtime plan |

## Setup

**This repo contains source only.** You need your own legitimate copy of Garry's Mod (Steam), and you
build the Wasm yourself. Nothing from the game is distributed here.

Requirements: Node 20+, Python 3.10+, a Chromium-based browser, and a Linux/macOS shell. The full
build is memory-hungry (peak ~2 GB per DLL) and the outputs are several GB.

```sh
npm install

# 1. Lift the game DLLs (once per game update)
cd tools/lift
python3 -m venv .venv && .venv/bin/pip install pefile capstone unicorn wasmtime keystone-engine lief
.venv/bin/python build_dll.py <GarrysMod>/bin/<dll> --base 0x00400000 --out out/<name>   # see tools/lift/README.md
.venv/bin/python difftest.py                                                              # sanity check the lifter
cd ../..

# 2. Serve it, pointing at your install
GMOD_ROOT="$HOME/.steam/steam/steamapps/common/GarrysMod" node web/server.mjs --port 8080
```

Open http://127.0.0.1:8080/ for the launcher. Useful URL parameters: `?edition=base` skips the launcher,
`?cmd=%2Bmap%20gm_construct` starts a map directly.

Tests: `npm test` (unit + runtime), `npm run test:unit`, `npm run test:lift`.
Headless browser smoke test: `node tools/web-test.mjs --seconds 60 --out run/web`.
`package:web` builds a self-contained bundle (`npm run package:web`); user addons and saves are never included.

## Branches and releases

- `main`: source (this tree).
- `cdn`: the packaged game as served to players: content-addressed 1 MiB parts plus a manifest (`tools/package-cdn.mjs`).
  Every version is a tag on it (`v26`, ...) with a GitHub release carrying its notes and play link.

## Status and legal

Performance on low-end hardware is still being worked on (`docs/performance-n4000.md`).
Garry's Web is an unofficial fan project. Garry's Mod and Source are owned by Facepunch Studios and Valve; this project is not affiliated with them. You must own
the game, and addons belong to their authors. The engine fork is derived from a public Source SDK repository
and keeps its original license.
