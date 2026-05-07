# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Run with hot reload (tsx watch)
npm run build      # Lint + compile to dist/ via tsup (minified)
npm run lint       # Biome check + auto-fix on all files
npm run start      # Run compiled dist/Bot.js (production)
npm run knip       # Detect unused exports/files
```

The bot uses an embedded SQLite database (`better-sqlite3`). A `data.db` file
is created in the working directory on first run — no external DB server needed.

**Tests (Vitest):**
```bash
npm test                   # Run all tests
npm run test:functional    # Functional tests only
npm run test:coverage      # Run with coverage report
```

**Docker:**
```bash
docker compose up -d           # Starts the bot (sqlite data persisted on the sano-data volume)
npm run docker:logs            # Tail bot logs
npm run docker:clean           # Full teardown including volumes
```

## Architecture

### Request Flow

A user command goes through one of two entry points in `src/listeners/messageListener.ts`:

1. **Text command** (`&play ...`) → `messageListener` parses the prefix+command, routes via `switch` to a function in `src/commands/textCommands.ts`
2. **Slash command** (`/play`) → `InteractionCreate` event routes to `src/commands/slashCommands/<name>.ts` via the `commands` map in `src/commands/slashCommands/index.ts`

Both paths ultimately call the same functions in `textCommands.ts`, which call into `src/core/requestHandlers/`.

### Play Request Handlers (`src/core/requestHandlers/`)

Three handlers resolve the input type before calling into the player:

- `songRequest.ts` — single YouTube URL → `youtubei.js` for metadata → `pushSongs` to DB → `songPlayer`
- `playlistRequest.ts` — playlist URL → iterates via `youtubei.js`, calls `songRequest` per item
- `searchRequest.ts` — text search → `youtubei.js` search (limit 1) → calls `songRequest` with the first result

### Player (`src/core/player.ts`)

`songPlayer(guildId)` is the core playback engine:
- Fetches the first song from SQLite (`nextSongs[0]`)
- Joins the voice channel stored in DB
- Creates/reuses an `AudioPlayer` stored in the in-memory `activePlayers` map (exported from `Bot.ts`)
- Streams audio via `yt-dlp` (spawned from `youtube-dl-exec`) piped to `createAudioResource`

`activePlayers` is an in-memory map `{ [guildId]: { audioPlayer } }` — the single source of truth for whether a guild is currently playing.

### State: In-Memory vs. Database

| State | Where |
|---|---|
| Is playing / AudioPlayer ref | `activePlayers` (in-memory, `Bot.ts`) |
| Song queue (`nextSongs`) | SQLite `guilds.data` (JSON column) |
| Play history (`previouslyPlayedSongs`) | SQLite `guilds.data` (JSON column) |
| Current voice channel | SQLite `guilds.data` (JSON column) |

On startup, `connectToDatabase` calls `emptyAllGuild()` — this wipes all queues
and voice channel state from every guild, since in-memory `activePlayers` is
always empty on a fresh start.

### SQLite Schema (`src/database/databaseConnect.ts`)

A single table:

```sql
CREATE TABLE guilds (
  id   TEXT PRIMARY KEY,   -- Discord guild ID
  data TEXT NOT NULL       -- JSON-encoded Guild
);
```

The `data` column stores the full `Guild` record from
`src/database/schema/guild.ts`:

- `guildId` — Discord guild ID
- `registeredAt` — first-seen timestamp
- `nextSongs[]` — ordered queue
- `previouslyPlayedSongs[]` — history (used by `/redo`)
- `currentVoiceChannel` — serialized voice channel data

WAL mode is enabled for better concurrent-write performance. All DB access
goes through `src/database/queries/guilds/{get,update,delete}.ts` — read the
JSON, mutate, write it back via the `upsertGuild` prepared statement.

### Slash Command Structure

Each slash command is a file in `src/commands/slashCommands/` exporting `data` (SlashCommandBuilder) and `execute(interaction)`. Slash commands are deployed automatically on `ClientReady` and `GuildCreate` events via `src/deploy-commands.ts`.

To add a command: create the file, export from `src/commands/slashCommands/index.ts`, and the listener + deploy are already wired.

### i18n

All user-facing strings go through `i18n.t('...')` (see `src/config/i18n.ts`). Locales are in `src/config/locales/` as JSON files (`en-US.json`, `fr-FR.json`). The active locale is set from `secrets.LANGUAGE` at startup.

When adding locale keys, they must be nested at the correct JSON path — top-level keys under `errors` won't resolve if the call uses `errors.play.missing.*`. Always verify the key path matches the nesting in the JSON file.

### Path Aliases

`tsconfig.json` sets `baseUrl: "./"` — imports use `src/...` absolute paths (e.g. `import { client } from 'src/Bot'`). This is resolved by `tsx` at dev time and `tsup` at build time.

## Environment Variables

Copy `.env.dist` to `.env`. Required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`.
Optional: `PREFIX` (default `&`), `LANGUAGE` (default `en-US`),
`DETECT_FROM_ALL_MESSAGES` (default `false` — if `true`, bot responds to
YouTube URLs in any message without prefix), `SANO_LOGO` (avatar/icon URL),
`DATABASE_PATH` (default `data.db`), `LOG_DIR` (default `./logs`),
`TIMEZONE` (default `Europe/Paris`, Docker only),
`YOUTUBE_COOKIES_PATH` (path to a Netscape-format `cookies.txt`).

## Branding

- Bot/footer name: `sano.music`
- Embed author name: `sano.senxpai`
- Default avatar/icon: `https://avatars.githubusercontent.com/u/201428450?v=4`

## Gotchas

- **Docker Alpine image** needs both `ffmpeg` and `python3` (`RUN apk add --no-cache ffmpeg python3`) — `python3` is required by some `youtube-dl-exec` internals.
- **`message.delete()` in `messageListener`** — always use a `DiscordAPIError`-aware catch; silently ignore codes `10008` (Unknown Message) and `50013` (Missing Permissions), log everything else.
- **SQLite file location** — defaults to `./data.db`. In Docker, set `DATABASE_PATH=/app/data/data.db` and mount a volume on `/app/data` so the DB persists.
