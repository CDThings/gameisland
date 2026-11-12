## Plugin submission

- Plugin ID: cando.gameisland
- Version: 0.1.0
- Publisher ID: cando

## Source repository and tag

Source: https://github.com/CDThings/gameisland @ immutable tag `v0.1.0`

## Capabilities and user workflow

Contributes a single sandboxed frontend workbench「游戏岛 / Game Island」: ten fully offline mini-games — four card tables (Guandan 掼蛋 per the official same-shape-beat rules, NiuNiu, Texas Hold'em, Mahjong; 1 human + 3 local AI opponents, same screen) and six kids' games (whack-a-mole, fishing, minesweeper, checkers, ludo, gomoku).

A user opens the workbench from the DBX sidebar / plugin entry and plays directly; the launcher lists all ten games. No DBX connections are created or used; no database work occurs. All game logic is client-side (engines are pure functions, no network calls); the only host API used is storage, to persist in-game saves / records / sound preferences locally.

## Permissions, data access, and network access

- `host.storage` only. The plugin stores a single key `cando.kv.v1` (a JSON blob of in-game saves / kids' records / mute preference), well under the 256 KiB single-value limit.
- No network permission. No credentials, files, or user data are read; no DBX connection data is accessed.

## Native sidecar behavior

None. Pure frontend universal package; no native executables, subprocesses, listening ports, filesystem writes, or external commands.

## License

MIT

## Homepage or support URL

(none yet; source repo: https://github.com/CDThings/gameisland)

## Confirmation

- [x] The candidate packages are unsigned and match the disclosed source tag (`v0.1.0`); built by the official `@dbx-app/plugin-cli` reusable release workflow, and the SHA-256 / size match the release's `release-candidates.json`.
- [x] I have not included private keys, tokens, credentials, or proprietary data.
- [x] The candidates are listed in `candidates/cando.gameisland.json`; `plugins/` and `catalog/` were not edited manually.
