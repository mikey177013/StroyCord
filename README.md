# sano.music

A clean, minimal Discord music bot.

- **Storage:** SQLite (zero config, no external DB).
- **Runtime:** Node.js 20+
- **Stream backend:** `yt-dlp` (auto-downloaded by `youtube-dl-exec`).
- **One file boots the bot anywhere:** `node index.js`.

---

## Commands

_Prefix every command with your configured prefix (default `&`, e.g. `&p [music]`)._

| Command | Aliases | Description |
| ------- | ------- | ----------- |
| `play [url or search]` | `p` | Start playing music |
| `redo` | — | Replay the last played track |
| `skip` | `s` | Skip the current track |
| `pause` | `pa` | Pause playback |
| `resume` | `re` | Resume playback |
| `fuckoff` | `fo` | Disconnect the bot and clear the queue |
| `queue` | `q` | Show the current queue |
| `current` | `c` | Show what is playing now |

Slash commands (`/play`, `/skip`, …) are auto-deployed when the bot joins a guild.

---

## Quick start (any machine)

```bash
git clone <this-repo> sano-music
cd sano-music
cp .env.dist .env        # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm install              # also auto-builds via postinstall
node index.js            # universal boot script
```

`index.js` is the single, panel-friendly entry point:

1. Installs production dependencies if `node_modules/` is missing.
2. Builds `dist/Bot.js` if it is missing.
3. Spawns the compiled bot.

You can also run any of these directly:

```bash
npm run dev         # tsx watch (hot reload, dev only)
npm run build       # tsup → dist/Bot.js
npm run start       # → node index.js (recommended)
npm run start:compiled  # → node dist/Bot.js (after a build)
```

---

## Hosting on game/bot panels

> All these panels run on Pterodactyl/Pelican-style game eggs that expect a single
> startup command. Use **`node index.js`** (or `bash start.sh`) as the startup
> command — that's it.

### OptikLink (and any Pterodactyl-based panel)

1. Create a new server using the **Generic Node.js** egg.
2. Upload the project (zip & extract, or `git clone` from the panel's file manager / SFTP).
3. **Startup command field:**
   ```
   node index.js
   ```
   _(if the panel uses a `${SCRIPT}` variable, set `SCRIPT=index.js` and keep `node ${SCRIPT}`.)_
4. **Environment variables** (panel UI → Variables):
   - `DISCORD_TOKEN` — your bot token (required)
   - `DISCORD_CLIENT_ID` — your application client ID (required)
   - `PREFIX` — default `&`
   - `LANGUAGE` — `en-US` or `fr-FR`
   - `DATABASE_PATH` — `./data.db` (default; persists in the panel volume)
5. **Install command** (if the panel runs one separately):
   ```
   npm install
   ```
6. Start the server. The first boot prints:
   ```
   [sano] node v20.x.y
   [sano] starting from dist/Bot.js
   [db] sqlite ready
   sano.music is online !
   ```

> **The exact error from your panel was:**
> `Cannot find module '/home/container/src/config/i18n' imported from /home/container/src/Bot.ts`.
> This happened because the panel was running `node src/Bot.ts` directly — Node
> cannot execute TypeScript. Fixing the startup command to **`node index.js`**
> solves it permanently.

### Katabump

1. Pick the **Node.js Bot** server template.
2. Upload via SFTP or `git clone https://github.com/<you>/sano-music`.
3. **Startup file** → `index.js`
4. **Startup command** → `node index.js`
5. **Node version** → 20 or higher (Node 22 LTS recommended).
6. Add `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in the env-vars tab.
7. Start. Katabump runs `npm install` automatically on first boot, which
   triggers our `postinstall` build step, so the bot is ready immediately.

### Railway

The repo ships with `railway.json` and `nixpacks.toml`, so:

1. Click **"New Project" → "Deploy from GitHub repo"**.
2. Pick this repo. Railway auto-detects Nixpacks.
3. In **Variables**, add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, optionally
   `PREFIX`, `LANGUAGE`, `DATABASE_PATH=/app/data/data.db`.
4. (Recommended) Add a **Volume** mounted at `/app/data` so the SQLite file
   survives redeploys.
5. Deploy. Railway runs:
   ```
   npm install && npm run build      # build phase
   node index.js                     # start phase
   ```

### Glacier Hosting

Glacier offers Pterodactyl-style game panels and Node.js bot hosting.

- **Bot panel:** identical to OptikLink — startup command = `node index.js`.
- **VPS:** treat it like the "Quick start" section above and run under
  `pm2`, `systemd`, or `tmux`. Example with `pm2`:
  ```bash
  npm install -g pm2
  pm2 start index.js --name sano
  pm2 save
  pm2 startup            # follow the printed instructions to enable on boot
  ```

### Docker (any VPS or Coolify/Dokploy/Sliplane)

```bash
cp .env.dist .env
docker compose up -d
```

The bundled `docker-compose.yml` mounts a `sano-data` volume on `/app/data`
so the SQLite file persists across rebuilds.

---

## Startup file reference

| File             | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `index.js`       | Universal boot script. Installs deps + builds + runs `dist/Bot.js`.  |
| `start.sh`       | Bash equivalent of `index.js` for Pterodactyl shell envs.            |
| `dist/Bot.js`    | Bundled, minified bot. Produced by `npm run build`.                  |
| `Procfile`       | `worker: node index.js` — for Heroku-style platforms.                |
| `railway.json`   | Build & start commands for Railway.                                  |
| `nixpacks.toml`  | Nixpacks build hints (Railway, Coolify, etc.).                       |
| `Dockerfile`     | Multi-stage Alpine image with `ffmpeg` + `python3` for `yt-dlp`.     |

> **Always set the panel's startup file/command to one of these:**
> - `node index.js` ← recommended
> - `bash start.sh`
> - `npm start`
>
> **Never** set it to `node src/Bot.ts` — Node cannot execute TypeScript.

---

## Environment variables

| Variable                   | Required | Default                                                  | Description                                                |
| -------------------------- | -------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `DISCORD_TOKEN`            | yes      | —                                                        | Your Discord bot token                                     |
| `DISCORD_CLIENT_ID`        | yes      | —                                                        | Your Discord application client ID                         |
| `PREFIX`                   | no       | `&`                                                      | Text-command prefix                                        |
| `DETECT_FROM_ALL_MESSAGES` | no       | `false`                                                  | If `true`, plays YouTube URLs posted without the prefix    |
| `LANGUAGE`                 | no       | `en-US`                                                  | Bot locale (`en-US` or `fr-FR`)                            |
| `SANO_LOGO`                | no       | `https://avatars.githubusercontent.com/u/201428450?v=4`  | Avatar/icon used in embeds                                 |
| `DATABASE_PATH`            | no       | `data.db`                                                | Path to the SQLite database file                           |
| `YOUTUBE_COOKIES_PATH`     | no       | —                                                        | Netscape `cookies.txt` for age-restricted videos           |
| `LOG_DIR`                  | no       | `./logs`                                                 | Log directory (Docker only)                                |
| `TIMEZONE`                 | no       | `Europe/Paris`                                           | Container timezone (Docker only)                           |

The bot also auto-creates the parent directory of `DATABASE_PATH` if it does
not exist, so paths like `/home/container/data/sano.db` work out of the box.

---

## Storage

sano.music uses **SQLite** via `better-sqlite3`. On first boot, the file at
`DATABASE_PATH` (default `./data.db`) is created with one table:

```sql
CREATE TABLE guilds (
  id   TEXT PRIMARY KEY,   -- Discord guild ID
  data TEXT NOT NULL       -- JSON-encoded guild record
);
```

WAL journaling is enabled for better concurrent-write performance. No external
database server is required.

---

## Branding

- Bot/footer name: **sano.music**
- Embed author name: **sano.senxpai**
- Default avatar/icon: <https://avatars.githubusercontent.com/u/201428450?v=4>

---

## Scripts

```bash
npm run dev         # tsx watch — hot reload
npm run build       # bundle with tsup
npm run start       # → node index.js (universal boot)
npm run start:compiled  # → node dist/Bot.js
npm run lint        # biome check + autofix
npm test            # vitest
```

---

## Troubleshooting

**`Cannot find module '.../src/config/i18n' imported from .../src/Bot.ts`**
The host is running `node src/Bot.ts` directly. TypeScript files cannot be
executed by Node. Change the panel's startup command to `node index.js`.

**`better-sqlite3` failed to install on Alpine / Docker**
Make sure `python3`, `make`, and `g++` are available at build time.
The provided `Dockerfile` already does this.

**`yt-dlp not found` / playback fails**
`youtube-dl-exec` downloads the binary on first run. On panels that wipe the
filesystem between deploys, this happens once per deploy automatically.

**Bot starts but slash commands are missing**
They are deployed to each guild on `ClientReady` and `GuildCreate`. Wait a
few seconds after first invite, or kick + reinvite the bot.

---

## License

GPL-3.0
