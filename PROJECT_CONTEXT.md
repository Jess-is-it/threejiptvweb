# 3J TV — Unified Project Context (Single File)

This is the **single file** to share with a new AI chat so it can understand this project.

If you only send one instruction to AI, use:

`Read /home/threejiptvweb/3j-tv/PROJECT_CONTEXT.md and follow AI_COMMAND_CONTEXT_SYNC.`

---

## AI_COMMAND_CONTEXT_SYNC (Mandatory)

If a change modifies any of the following, update this file in the same patch/PR:
- feature/function
- process/workflow
- tech stack/dependencies
- routes/pages/API endpoints
- data model/storage
- deployment/runtime behavior

Do not finish the task until project context docs are synced.

---

## Consolidation Status

This file is the unified replacement for older split docs.

Kept:
1. `AGENTS.md`
2. `README.md`
3. `PROJECT_CONTEXT.md` (this file)

Removed during cleanup:
- `docs/CODEX_PROJECT_CONTEXT.md`
- `deploy/systemd/README.md`

---

## 1) Repository Guidelines (from `AGENTS.md`)

### Project Structure & Module Organization
- `app/`: Next.js App Router pages + API routes (`app/api/*/route.js`).
- `components/`: shared React UI (players, rows, header, providers).
- `lib/`: server/client utilities and configuration (admin auth/db, settings).
- `public/`: static assets (brand/logo, auth backgrounds, placeholders).
- `data/`: local persistence for admin settings/secrets (`data/.admin/*.json`, gitignored).

Admin portal lives under `app/admin/*` (protected routes in `app/admin/(protected)`).

### Build, Test, and Development Commands
Run from `3j-tv/`:
- `npm run dev`: start local dev server (default `http://localhost:3000`).
- `npm run build`: production build (validates routes and bundles).
- `npm run start`: run the production build locally.
- `npm run lint`: Next.js ESLint checks.

Tip: do **not** run Next commands as `root`—it can create root-owned `.next/` artifacts and cause `EACCES`/500 errors. Fix with:
- `sudo chown -R threejiptvweb:threejiptvweb .next`

### Coding Style & Naming Conventions
- JavaScript/JSX (App Router + Route Handlers). Prefer small components and clear props.
- Indentation: 2 spaces for JS/JSX.
- Routing: keep paths consistent (`/movies/[id]`, `/watch/movie/[id]`, `/admin/*`).
- Styling: Tailwind CSS v4. Admin uses CSS tokens like `--admin-bg`, `--admin-text` (see `styles/globals.css`).

### Testing Guidelines
There is currently **no automated test suite**. Use:
- `npm run lint` and `npm run build` for CI-like validation.
- Manual smoke checks for key flows (login, movies/series playback, `/admin` settings edits).

### Commit & Pull Request Guidelines
- Follow Conventional Commits used in history (e.g., `feat(admin): …`, `fix(ui): …`, `chore(deps): …`).
- PRs should include: short description, screenshots for UI changes (admin + public pages), and any config changes (`.env.local` keys, new settings fields).

### Security & Configuration Notes
- Secrets are currently editable/displayed in the Admin portal for ease-of-use; plan to harden before deployment.
- Prefer managing configurable values via Admin Settings/Secrets instead of hardcoding in components.

---

## 2) Codex Project Context (Embedded)

### Project Overview
- **Project name:** 3J TV
- **Repo path:** `/home/threejiptvweb/3j-tv`
- **Type:** Next.js App Router full-stack app
- **Main domains:**
  - Public IPTV streaming UI (Home/Movies/Series/Live + immersive watch pages)
  - Admin Portal (settings, secrets, admins, reports)
  - AutoDownload system (Engine Host via SSH, NAS mount, qBittorrent, processing, XUI scan triggers)

### Tech Stack
- Next.js `15.4.6`, React `18.3.1`, App Router
- Tailwind CSS v4
- `hls.js` for streaming playback
- `ssh2` for remote Engine Host command execution
- `undici` for server-side HTTP
- `bcryptjs` for admin auth hashing
- Local/Netlify-backed JSON storage abstraction via `lib/server/blobStore.js`

### Key Directories
- `app/` — pages + API routes
- `app/admin/` — admin pages (protected shell + auth/setup)
- `app/admin/_components/` — admin panels/modals/navigation
- `app/api/` — backend route handlers
- `components/` — public UI, providers, player
- `lib/server/` — auth/db/settings/secrets/vault/mailer
- `lib/server/autodownload/` — AutoDownload services (SSH, mount, qB, processing, scheduler, XUI)
- `data/.admin/` — local JSON data store (`db.json`, key file) outside Netlify context
- `deploy/systemd/` — service and timer units for production

### Primary User Routes
- Public: `/login`, `/home`, `/movies`, `/movies/[id]`, `/series`, `/series/[id]`, `/live`, `/bookmarks`, `/request`
- Watch: `/watch/movie/[id]`, `/watch/series/[seriesId]/[episodeId]`, `/watch/live/[id]`
- Admin auth: `/admin/login`, `/admin/setup`
- Admin protected: `/admin`, `/admin/settings`, `/admin/category-settings`, `/admin/secrets`, `/admin/admins`, `/admin/reports`
- Admin request management:
  - `/admin/requests` (request queue + status workflow + archive controls)
  - `/admin/request-settings` (daily limits, default landing category, status labels)
- AutoDownload admin:
  - `/admin/autodownload/engine`
  - `/admin/autodownload/storage`
  - `/admin/autodownload/qbittorrent`
  - `/admin/autodownload/settings`
  - `/admin/autodownload/readiness`
  - `/admin/autodownload/sources`
  - `/admin/autodownload/movies`
  - `/admin/autodownload/movies/selection-log` (legacy redirect to `/admin/autodownload/movies`)
  - `/admin/autodownload/series`
  - `/admin/autodownload/library`
  - `/admin/autodownload/processing-log`
  - `/admin/autodownload/xui`
  - `/admin/autodownload/scan-log`

### Core APIs
- Admin auth + profile: `/api/admin/login`, `/api/admin/logout`, `/api/admin/me`, `/api/admin/setup`
- Admin config: `/api/admin/settings`, `/api/admin/secrets`, `/api/admin/users`, `/api/admin/reports`
- Public auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/health`
- Playback proxy: `/api/proxy/hls` (rewrites playlists, proxies segments/keys, handles fallback)
- Content APIs: `/api/xuione/*`, `/api/tmdb/*`
- Public feedback: `/api/public/reports`, `/api/public/notifications`
- Public AutoDownload upcoming: `/api/public/autodownload/upcoming` (`GET` upcoming/released lists, `POST` reminder subscribe), `/api/public/autodownload/upcoming/details` (TMDB-enriched details for upcoming/released queue items)
- Public requests: `/api/public/requests` (`GET` quota/settings/active request states + per-user request history payload, `POST` actions: `submit|state|remind`)
  - includes TMDB request catalog endpoint `GET /api/public/requests/catalog` (supports request-page browse/search/infinite-scroll with `include_adult=false` and genre filters)
  - includes TMDB/XUI series picker endpoint `POST /api/public/requests/series-options` (body: `tmdbId`, optional `streamBase` + title/year hints) that returns season/episode rows with TMDB still images and per-episode XUI availability tags for scoped requests
- AutoDownload: `/api/admin/autodownload/*` (engine, mount, download client, settings, processing, scheduler, xui, logs)
 - Request admin APIs:
   - `/api/admin/request-settings` (`GET`/`PUT`)
   - `/api/admin/requests` (`GET` queue + counts, `PATCH` actions: `status|archive`)
  - includes library inventory endpoint `GET/POST /api/admin/autodownload/library-inventory` (NAS scan cache of Movies/Series for duplicate checks + admin visibility)
    - `POST` supports `action=clean_preview` (dry-run scan with affected/change/delete counts)
    - `POST` supports `action=clean_run` (confirmed in-place clean on final library paths)
  - includes source-provider health APIs under `/api/admin/autodownload/sources*`
  - source-provider endpoints include:
    - `POST /api/admin/autodownload/sources/:id/test`
    - `POST /api/admin/autodownload/sources/:id/validate`
    - `POST /api/admin/autodownload/sources/test-all`
    - `GET /api/admin/autodownload/sources/logs` (supports provider/domain/status/error filters)
    - `DELETE /api/admin/autodownload/sources/logs` (clear provider/all logs + reset domain health cache)
  - processing log endpoint `DELETE /api/admin/autodownload/processing-log` clears all Processing Log entries from admin DB
  - queue creation endpoint `POST /api/admin/autodownload/downloads` is TMDB-only (manual URL add is disabled in admin UI/API)
  - bulk queue endpoint `POST /api/admin/autodownload/downloads/bulk` supports temporary admin bulk actions (currently `delete_all` for queue + qB cleanup); NAS library purge is safety-locked and requires explicit backend unlock + confirmation payload
  - scheduler tick endpoint `POST /api/admin/autodownload/scheduler/tick` supports optional scoped runs via body/query `type=movie|series|all`

### System Architecture (Operational)
1. **Public playback flow**
   - User authenticates via `/api/auth/login` (Xtream/XUI validation).
   - Session stored client-side by `components/SessionProvider.jsx`.
   - Watch pages use `components/VideoPlayer.jsx`.
   - HLS URLs are served through `/api/proxy/hls`.
2. **Admin flow**
   - Cookie-based admin sessions from `/api/admin/login`.
   - Protected UI rendered via `app/admin/(protected)/layout.jsx` and `app/admin/_components/AdminShell.jsx`.
3. **AutoDownload flow**
   - Engine host registered (encrypted SSH creds).
   - NAS mount managed via CIFS + `/etc/fstab` health logic.
   - qBittorrent provisioned/controlled on Engine Host.
   - Completed downloads move through staging -> processing -> final.
   - TMDB normalization + cleanup rules applied in processing.
   - XUI watchfolder scans triggered with pending/cooldown logic.

### Data Storage Model
Main object is in admin DB (`lib/server/adminDb.js`), including:
- `admins`, `sessions`, `secrets`, `settings`
  - Public `settings.catalog` now stores category labels (Home/Movies/Series row names) and row behavior controls (top-row rotation cadence, display counts, pool sizes).
- `reports`, `notifications`
- `requestSettings` (daily limit default, per-username daily overrides, default landing category, customizable display labels for fixed request statuses)
- `requests` (one row per TMDB media id + media type, deduped globally, with requesters/reminder subscribers, status workflow, archive support)
- `upcomingReminders` (per TMDB media row reminder subscribers used by Worth-to-wait notifications)
- `engineHosts`, `mountSettings`, `mountStatus`
- `autodownloadSettings`
- `downloadsMovies`, `downloadsSeries`
- `processingLogs`, `selectionLogs`
- `sourceProviders`, `sourceProviderLogs`, `sourceProviderDomains`
  - `sourceProviderDomains` is the canonical per-domain/base health store (status, failure streak, backoff, last error, duration, ordering).
  - `sourceProviderDomainHealth` remains as a legacy compatibility array and is no longer authoritative.
- `libraryInventory` (persisted Movies/Series NAS snapshot for admin KPIs + duplicate checks, including folder-count rollups by movie category/genre and series genre, plus count-report write status/paths)
- `xuiIntegration`, `xuiScanState`, `xuiScanLogs`

### Important Current Behaviors
- Scheduler orchestration: `lib/server/autodownload/schedulerService.js`
- Processing pipeline: `lib/server/autodownload/processingService.js`
- XUI debounced scan logic: `lib/server/autodownload/xuiService.js`
- qB provisioning/auth logic: `lib/server/autodownload/qbittorrentService.js`
- AutoDownload download/sync/control now opens an authenticated qB WebUI session using stored encrypted credentials (cookie-based login per SSH job) and treats HTTP/transport failures as hard errors instead of silent success.
- Download sync now enforces expected qB placement/category for managed items (`MOVIE_AUTO`/`SERIES_AUTO`, configured Downloading/Downloaded folders) using qB `setLocation` + `setCategory`.
- qBittorrent settings now include a dedicated admin `qBittorrent Options` section on `/admin/autodownload/qbittorrent` (`downloadClient.autoDeleteCompletedTorrents`, `autoDeleteCompletedDelayMinutes`, `maxActiveDownloads`, `maxActiveUploads`, `maxActiveTorrents`); sync auto-removes completed torrents from qB (`deleteFiles=false`) only after the configured delay, runtime queue limits are applied via qB preferences, and `GET /api/admin/autodownload/download-settings` now best-effort syncs queue-limit values from qB runtime by trying SSH/LAN API endpoints first then falling back to qB config parsing so admin UI reflects actual qB values.
- Download sync auto-delete now also covers finalized managed torrents in qB (Completed/Processing/Cleaned/Released/Deleted), including managed orphan torrents not actively tracked in queue rows, still honoring `autoDeleteCompletedTorrents` + `autoDeleteCompletedDelayMinutes`; finalized rows whose torrent is already missing in qB are marked as `qbDeleteStatus=missing_in_client`.
- Queue-to-torrent binding now prefers strict source-hash matching and avoids fallback mis-linking when a source hash is known.
- Download source provider health/backoff/log orchestration: `lib/server/autodownload/sourceProvidersService.js`
- Provider adapter engine modules: `lib/server/autodownload/providers/*`, `sourceEngine.js`, `ranking.js`, `filters.js`
- AutoDownload staging folders are under `<mountDir>/qBittorrent/Movies` and `<mountDir>/qBittorrent/Series`; final library categories/genres stay under `<mountDir>/Movies` and `<mountDir>/Series`.
- AutoDownload library folder defaults now use `Downloaded and Processing` (downloaded stage) and `Cleaned and Ready` (processing hold stage) for both Movies and Series.
- AutoDownload processing + folder-validation no longer renames Movie/Series category or genre folders with count suffixes (e.g., `English(174)`); canonical folders remain unsuffixed (`English`, `Asian`, genre names).
- Admin Library Inventory now exposes live folder-count chips (`Category (count)`, `Category/Genre (count)`, `Series Genre (count)`) so counts stay visible without mutating NAS folder names.
- Each inventory sync now writes Explorer-visible NAS reports: `<mountDir>/Movies/_folder_counts.txt` and `<mountDir>/Series/_folder_counts.txt`.
- Folder validation (`/api/admin/autodownload/mount/validate-folders`) now auto-normalizes legacy count-suffixed category/genre directories by renaming/merging them into canonical unsuffixed folders.
- Admin shells (`/admin`, `/admin/login`, `/admin/setup`) now expose `data-admin-ui="1"` and light-mode CSS overrides that darken neon Tailwind status colors (`text-*-200/300`, `bg-*/10..20`, `border-*/30..40`) for better readability.
- Admin Readiness and Library Inventory warning/success/status pills now use admin theme tokens (`--admin-pill-*`) instead of fixed neon classes, and light-theme token contrast has been strengthened so the `8/8` sanity badge and Clean Library preview notes/buttons remain readable in light mode.
- Critical readiness/library warning surfaces (`8/8` badge, sanity status pills, Clean Library note cards/buttons) now set tone colors via inline `style` from token vars (`toneVars(...)`) to avoid Tailwind variant/cache mismatches in light mode.
- Admin UI color system now standardizes around theme tokens (`--admin-primary`, `--admin-secondary`, `--admin-tertiary`) with semantic `admin-btn-*` classes and broader compatibility remapping for legacy Tailwind neon utility classes (status text/background/border + hover) so light mode keeps consistent contrast across admin pages/modals.
- AutoDownload selection runs stamp release metadata (`releaseDate`, `releaseTag`, timezone, delay-days) into queue records + selection logs; release delay is configurable in AutoDownload Settings (`release.delayDays`, default 3, timezone default `Asia/Manila`).
- Processing now cleans completed items into per-release hold folders under `Cleaned and Ready/ReldateM-D-YY/*`; final category/genre placement is deferred until release date.
- Scheduler timeout flow now emits timed-out metadata and performs same-log replacements (same `selectionLogId` + release date/tag) before release date.
- Release workflow is date-driven: when due, cleaned held items move to final library paths, not-ready items are dropped/deleted, watchfolder pending flags are set, and reminder subscribers receive availability notifications.
- Movie release deploy now preserves the cleaned movie folder name into final genre paths (instead of flattening files directly into genre root).
- Release workflow now also prunes empty release-tag hold folders (`Cleaned and Ready/Reldate...`) after successful deploy moves (including recursive empty-subfolder pruning before removal), so stale empty Reldate directories do not accumulate.
- Public Home now includes queue-backed `Worth to wait` (upcoming held items) and `Recently Added` (released queue items) rows from the new public AutoDownload upcoming APIs.
- Public Movies and Series pages now also render queue-backed `Worth to wait` rows (`/api/public/autodownload/upcoming`) scoped to media type (movie/tv).
- Public catalog rows (Home/Movies/Series) now read admin-configurable `settings.catalog.labels.*`, so row names can be renamed without code changes.
- Movies/Series top rows now support deterministic rotating pools (`settings.catalog.categories.topMovies/topSeries`) with default 3-day replacement cadence and configurable display/pool sizes; Movies defaults to a larger rotating set (60 cards from top 240) for higher variety.
- Admin now includes `/admin/category-settings` to manage public category names and category behavior (rotation cadence, visible-card counts, genre-row limits).
- On Movies/Series pages, `Worth to wait` is shown near the bottom of each page’s content stack (Movies: before the `All Movies` grid), and upcoming/released queue rows now hydrate missing poster/backdrop art from TMDB details by ID (cached) with `/placeholders/poster-fallback.jpg` as final fallback.
- Queue-backed upcoming movie cards now show a compact month/day release badge (`MMM D`); clicking those cards opens the preview modal directly (play-first bypass), and the modal’s top metadata line shows ratings first, then `Release date: <MMM D, YYYY>`, followed by genre/duration/year, plus description/cast and bottom-left `Remind me` + `More info` actions (red icon button via POST `/api/public/autodownload/upcoming`, action `remind`).
- Movie/Series detail pages support `?upcoming=1` mode for Worth-to-wait titles with TMDB metadata + trailer/cast + reminder action; released rows route back to normal detail pages.
- XUI catalog APIs now normalize `added` timestamps (`added/date_added/last_modified`) for VOD/Series rows and return no-store responses; Movies page `Recently Added` now sorts by that XUI-added time and polls every 60s so newly released XUI titles surface quickly.
- CIFS mount orchestration now applies `uid/gid` ownership mapping (resolved to numeric IDs when needed) in test/mount/status auto-remount flows, preventing qB `Permission denied` writes on NAS-mounted `qBittorrent/*/1-Downloading`.
- AutoDownload Settings modal validates HH:MM schedule inputs client-side; valid times now correctly enable Save in `Edit Enable & Schedule`.
- AutoDownload Settings now include source-quality gates (`sourceFilters.minMovieSeeders`, `sourceFilters.minSeriesSeeders`) in addition to size limits.
- AutoDownload Settings now include cleaning controls (`cleaning.enabled`, `cleaning.createMovieFolderIfMissing`, `cleaning.templates.*`) and strict series-timeout policy flags (`timeoutChecker.strictSeriesReplacement`, `timeoutChecker.deletePartialSeriesOnReplacementFailure`).
- Scheduler cleaning now runs sequentially through all `Completed` items each tick (no per-tick max cap) when cleaning is enabled; manual processing endpoints still support targeted single-item runs.
- Cleaning pipeline now applies configurable naming templates (movie folder/file/subtitle + series folder/season-folder/episode/subtitle), flattens nested files, keeps only allowed video/subtitle file types, deletes the rest, and writes cleaned output into `Cleaned and Ready/Reldate.../<templated-folder>`.
- After a successful clean, processing now performs a guarded source-path cleanup: if the original torrent path still exists under configured qB stage roots (`Downloading` / `Downloaded and Processing`), it is removed to prevent completed assets from lingering in `1-Downloading` after copy-fallback moves.
- Scheduler processing ticks now also run a one-time stale-source cleanup pass for existing `Cleaned`/`Released`/`Deleted` rows, removing leftover source paths from qB stage roots and recording `sourceCleanup*` metadata on queue rows.
- Cleaning title parsing now strips common release/quality tags (`1080p`, `4k`, codec/source tokens, YTS tags) from `title` tokens before template rendering, preventing duplicate quality fragments like `-1080p -1080p` in folder/file rename targets.
- Cleaning subtitle handling now preserves all recognized subtitle file extensions (`srt/ass/ssa/sub/vtt`), including files without explicit language tags, while still applying language token naming when available.
- Admin `Clean Library` preview modal now shows summary KPIs only (affected/changed/deleted/warnings + folder totals including created/renamed/deleted), hides per-file planned lists, no longer shows scanned-title counters, and includes a top preview note with deleted-file extension breakdown (e.g., `png:10, unknown:45`).
- Clicking `Files Deleted` in the preview opens a detailed modal listing files queued for deletion plus grouped summaries by file format and delete category/reason; cleaner summary now emits `deletedByExtension` and `deletedByReason`.
- In the `Files To Be Deleted` modal, both `By File Format` and `By Delete Category` chips are clickable filters with `Clear filters`, and the file table updates to matching rows.
- Clicking `Folders Deleted` in the preview now opens a dedicated `Folders To Be Deleted` modal with a guide note, reason-group summary, and per-folder rows (`path` + delete reason) so admins can understand why folders are being removed before confirming cleanup.
- Clicking `Folders Renamed` in the preview now opens a dedicated `Folders To Be Renamed` modal with guide text plus `from -> to` rows and action labels, so admins can review template-driven folder renames before confirming cleanup.
- Cleaning recovery now retries rows that failed with `Unable to determine download path` by re-scanning configured Downloaded-and-Processing folders (including sudo path probes/listing fallback) so previously completed items can still be cleaned.
- If a stale duplicate row cannot be recovered but another matching row is already `Cleaned`/`Released`, the stale row is auto-marked `Deleted` as superseded to stop endless retry churn.
- Processing pass now also removes orphaned UUID stage folders under `Cleaned and Ready` (except actively `Processing` rows) before queue cleaning, preventing stale temp folders from lingering.
- When timed-out series replacements cannot be fulfilled from configured sources, strict mode can auto-delete partial series rows/assets for that selection log, annotate selection-log failure metadata, and trigger fallback series selection/dispatch.
- Admin AutoDownload navigation is in the left sidebar as an expandable (chevron) sub-navigation under `AutoDownload`; top-level items are `Sanity Check`, `Movies`, `Series`, and `Library Inventory`, while the remaining AutoDownload pages are grouped under a nested `Settings` section; active sub-links use primary-color highlighting, and qBittorrent lives at `/admin/autodownload/qbittorrent` (legacy `/admin/autodownload/download-settings` redirects).
- Admin AutoDownload includes `/admin/autodownload/sources` for Download Sources (YTS/TPB), with provider cards, status badges, active base display, test/test-active actions, configuration modal, and provider logs.
- Admin AutoDownload includes `/admin/autodownload/readiness` (AutoDownload Sanity Check) to run sanity checks across Engine Host, Mount, qBittorrent, Download Sources, Settings, and XUI before end-to-end testing.
- Sidebar `Sanity Check` nav item shows a live score tag (`passed/total`, e.g., `8/8`) from `GET /api/admin/autodownload/readiness/summary`.
- YTS now uses ordered base domains (`https://yts.mx`, `https://movies-api.accel.li`) plus configurable API base path (`/api/v2/`) and endpoint (`list_movies.json`).
- TPB uses ordered base domains plus configurable search path template.
- Both providers support domain/base validation, domain-level health state, per-domain backoff, and active-domain rotation (active first, then ordered fallback domains).
- Runtime source test/search logs now capture attempted domain list and per-attempt outcomes for transparency (`attempted_domains`, `per_attempt_outcomes`, `selected_domain`).
- TPB blocked-signature detection now uses explicit challenge markers (captcha/challenge/access-denied patterns) and avoids generic `cloudflare` substring false positives from analytics scripts.
- Provider status recovery: a successful test/search newer than recent blocked logs clears `blocked` status (unless backoff is active or failure-streak threshold is still exceeded), allowing transition to degraded/healthy.
- Download Sources Provider Logs support admin-clearing via UI button; backend `DELETE /api/admin/autodownload/sources/logs?provider=all|yts|tpb` clears logs and resets per-domain health state for the selected provider scope.
- Movies/Series queue UI no longer exposes manual torrent/magnet URL add; only TMDB-based queueing is allowed.
- Source filtering for queue dispatch now enforces settings-driven seeders + size policy at search time; movie max size (e.g., 2.5 GB) and min seeders are applied before torrent add.
- Dispatch now performs a final policy gate before qB add (min seeders + size), even after provider selection, to prevent policy drift from queued stale sources.
- qB runtime now has a hard size-limit guard: if actual torrent size exceeds configured max (Movie/Series), the torrent is auto-deleted from qB, job is returned to `Queued`, and a size-limit error is recorded for retry with another source.
- Download sync now self-heals missing qB torrents for non-final rows: when a row points to a `qbHash` no longer present in qB, it is converted from `Downloading`/active states back to `Queued` with `qbHash=null` for automatic retry, avoiding stale “Downloading” rows with no real torrent.
- Download sync preserves terminal row states (`Processing`, `Cleaned`, `Deleted`, `Released`) when matching live qB torrents, so superseded/deleted rows are not resurrected back to `Completed`.
- Timeout checker now deduplicates active rows by torrent hash and only applies timeout deletion to the newest active row per hash; older duplicate rows are marked `Deleted` as superseded, preventing stale historical rows from deleting newly re-added torrents that reuse the same hash.
- Scheduler now detects movie dispatch failures caused by size-limit rejections and runs an immediate supplemental movie selection (without updating daily `lastMoviesRunAt`) to replace rejected slots, then performs a follow-up movie dispatch pass for those replacements.
- YTS source links now prefer tracker-backed `.torrent` download URLs (with enriched magnet fallback), improving peer discovery vs legacy trackerless BTIH-only magnets.
- Movies/Series admin pages no longer expose any manual add action; queue seeding is automatic from selection strategy.
- Movies page now focuses on `Selection Log` only; clicking a run row opens a modal scoped to that run’s selected TMDB items, merged with current queue state (the previous Jobs-tab table is moved into this modal flow).
- Movies Selection Log modal now resolves each TMDB row to the best queue record by priority (`same selectionLogId` first, then non-deleted/latest), preventing stale historical `Deleted` rows from overriding current-run items.
- Movies Selection Log status display now derives release lifecycle states: `Cleaned` rows with `releaseState=waiting` show `Waiting to be released`, and released rows show `Deployed in XUI`; release-date table cells now show date only (no redundant `Reldate...` tag).
- Admin Movies Selection Log status tags/alerts/error text now use theme-aware admin color tokens, improving readability in Light mode (status pills, warning/error badges, and success/error notices).
- Movies Selection Log modal now allows editing `Release date` for not-yet-released runs; `PATCH /api/admin/autodownload/selection-log` with `action=set_release_date` updates the selection-log release date/tag and all linked unreleased queue rows for that run.
- Movies page no longer renders a single-item top subnav tab (`Selection Log`) to reduce redundant UI.
- Movies Selection Log modal is rendered above admin shell layers (sidebar/topbar) for full-focus inspection.
- Movies Selection Log includes temporary QA controls: `Trigger AutoDownload Once`, `Delete All` (queue + qB only), and `Clear Log`.
- Movies jobs modal includes explicit size-rejection visibility via `Rejected by size limit` filter and `Size Rejected` row badge.
- Movie bulk delete flow is resilient to malformed qB `torrents/info` responses (JSON recovery + category-first query + fallback path).
- Movie `Delete All` file removal scope is strict: only torrent data currently saved under `<mountDir>/qBittorrent/Movies/*` is deleted; final library paths under `<mountDir>/Movies/*` are never part of this cleanup.
- Movie `Delete All` now also clears Movie Selection Log entries by default (same action call), and reports deleted log count in the success message.
- Movie NAS purge is no longer available from admin UI. Backend only allows it when `ALLOW_MOVIE_LIBRARY_PURGE=true` and request payload includes both `explicitUserInstruction=true` and `confirmPhrase=PURGE_MOVIES_LIBRARY`; otherwise purge is blocked.
- AutoDownload includes `/admin/autodownload/library` (Library Inventory) with Movies/Series separation and KPI cards; inventory snapshots are persisted in DB (`libraryInventory`) for duplicate checking.
- Library Inventory now has a `Clean Library` flow (preview + confirmation modal) that can clean existing final library Movies/Series in place (not `qBittorrent/*`), honoring file rules + cleaning templates and showing impact counts before execution.
- Selection now pre-validates source availability during TMDB picks; candidates with no valid source are skipped and the engine keeps searching for alternatives.
- Dispatch now iterates past failed queued candidates (e.g., `No valid source found`) until it starts the per-type target count, instead of stopping at the first failed subset.
- Scheduler tick API no longer forces runs just because caller is an admin; force mode requires explicit `force=true`.
- Scheduled dispatch is tied to fresh selection runs (or explicit force), so automatic queue starts happen at selection schedule time rather than every timer tick throughout the day.
- `GET /api/admin/autodownload/downloads?type=movie|series` performs first-run auto-seeding checks for both queues when empty (using `lastMoviesRunAt` / `lastSeriesRunAt`) and auto-dispatches pending queued rows by default; pass `seed=0` and/or `dispatch=0` to read queue state without those side effects.
- Selection dedupe now uses active queue rows plus library-inventory/final-library checks (not historical processing logs), so previously deleted test titles can be re-selected when they are no longer in the library.
- Selection engine supports both `runMovieSelectionJob` and `runSeriesSelectionJob`; scheduler ticks can run both or a scoped type (`movie`/`series`) for manual test triggers.
- AutoDownload Settings now include both Movie Selection Strategy and Series Selection Strategy blocks.
- XUI Watchfolder Trigger controls are managed from `/admin/autodownload/xui` (XUI Integration page), not `/admin/autodownload/settings`.
- XUI Scan state actions are simplified to `Manual Scan` (Movies/Series) and execute immediate manual scan requests.
- XUI integration watchfolder IDs support legacy keys (`watchFolderId`, `watchFolderIdMovie`) and normalize to `watchFolderIdMovies`/`watchFolderIdSeries`.
- Public request backend now enforces per-user daily quota (default `3`, with per-username overrides), dedupes by `mediaType + tmdbId`, supports reminder subscriptions, and exposes request-state lookups for request-card UI state.
- Public request backend state/submit flows now use authenticated XUI catalog checks (via `streamBase`) to mark already-available titles as `Available Now` and block duplicate request submissions for titles already in XUI.
- XUI availability detection for request cards now matches by TMDB id when present, with normalized title signatures (including compact/diacritic-safe forms and original title fallback) to improve `Available Now` tagging reliability.
- TV request entries now persist request-target metadata plus selected season/episode pair lists (cross-season capable) and episode units so admin queue/notifications keep scope context and series quotas can be enforced.
- Admin request backend now supports queue sorting by most requested first (`requestCount`), fixed status workflow (`pending`, `approved`, `available_now`, `rejected`, `archived`), and archive actions for completed/rejected cleanup.
- When request status transitions to `available_now`, notifications are pushed to all usernames in `reminderSubscribers`.
- Admin sidebar now includes dedicated `Requests` and `Request Settings` entries, with pages bound to `/api/admin/requests` and `/api/admin/request-settings`.
- Admin Requests Queue now supports row selection + bulk status transitions + bulk archive actions; backend `PATCH /api/admin/requests` accepts bulk `ids` for `action=status`.
- Admin Requests Queue status navigation now has quick filter links from KPI cards and row status badges (jump directly to matching queue filter tab).
- Request-card secondary status labels now render using customizable request status tags from Request Settings for consistent labeling across public/admin surfaces.
- Public `/request` page now includes TMDB infinite scroll, search + clear, horizontal genre filters (`Popular`, `Tagalog`, `Anime`, `Action`, `Adventure`, `Comedy`, `Horror`, `Romance`, `Drama`, `Sci-fi`), request-card states (`Available Now`, `Requested`, requestable), reminder modal action, and a floating request cart with daily-limit enforcement.
- Public `/request` page includes a `My Requests` view (beside Movies/Series) showing user request history with status, requested date, status-updated date, and downloaded/available state.
- Selected requestable cards on `/request` now show a full-card dark gradient overlay plus a larger top-right check badge for clearer selected-state visibility.
- Selecting a requestable series on `/request` now opens a TMDB-backed scoped picker with collapsible season rows and larger episode cards (TMDB still background); it starts with no preselected episode, users can select episodes across multiple seasons, each season row shows current selected count, episodes already found in XUI are tagged `Available` and disabled, and `Request all missing episodes` auto-checks only not-yet-downloaded episodes (per season) up to remaining per-day series quota. The modal submit button shows selected-episode count, and if TMDB/XUI checks show all episodes already available the modal auto-closes and the series card is marked `Available Now`.
- Request Settings now include `seriesEpisodeLimitDefault` (default `8` per day), and request submission enforces this daily per-user series-episode quota alongside the title-count quota.
- Request submit feedback now reports reason-specific skips (`already requested`, `already available`, `daily limit`) and keeps daily-limit-rejected items in the request cart for retry.
- Header request CTA is now contextual by route (`Request` on Home, `Request Movie` on Movies pages, `Request Series` on Series pages) and routes to `/request?type=all|movie|tv`.
- Playback proxy (`/api/proxy/hls`) uses an undici dispatcher with `bodyTimeout: 0` to avoid long VOD streams being cut mid-playback.
- Movie watch page (`/watch/movie/[id]`) now prefers HLS first in `VideoPlayer` and falls back to MP4 only if needed.
- Production runtime uses `NEXT_DIST_DIR=.next-runtime` to isolate live chunks from local/dev builds and reduce ChunkLoadError during updates.
- `npm run build:runtime` now blocks if `3j-tv.service` is running, to prevent live chunk rewrites during build.
- Local admin DB writes (`lib/server/blobStore.js`) now use unique temp filenames per write before rename, preventing concurrent-save `ENOENT` races on `db.json.tmp`.
- qB WebUI auth is configured to require credentials (no bypass):
  - `WebUI\\LocalHostAuth=true`
  - `WebUI\\AuthSubnetWhitelistEnabled=false`

### Environment and Deployment
- Typical env keys:
  - `ADMIN_DATA_KEY` (required for vault encryption)
  - `TMDB_API_KEY`
  - `MAIL_FROM`, `MAIL_USER`, `MAIL_PASS`
  - `SCHEDULER_TOKEN`
  - optional: `ALLOW_INSECURE_UPSTREAM_TLS`, `PINNED_SERVER`, `LOAD_BALANCING_ENABLED`
- Run:
  - `npm run dev`
  - `npm run build`
  - `npm run build:runtime` (production dist used by systemd)
  - `npm run start`
  - `npm run lint`
- Systemd units:
  - `deploy/systemd/3j-tv.service`
  - `deploy/systemd/3j-tv-scheduler.service`
  - `deploy/systemd/3j-tv-scheduler.timer`

### Working Rules for AI Agents
1. Read `AGENTS.md` first (or this unified file equivalent section).
2. Make targeted changes only; avoid unrelated refactors.
3. Keep admin-config-driven behavior intact.
4. Prefer service-layer fixes over UI-only patches.
5. Validate with `npm run build` and route/API checks after edits.
6. Never trigger destructive NAS purge actions (`purgeNas=true`) unless the user explicitly asks in the current chat and confirms; default/safe behavior is queue + qB cleanup only.

---

## 3) Root README Summary (from `README.md`)

### Project Context for AI/Codex
- Primary project knowledge file: `PROJECT_CONTEXT.md`.
- Mandatory AI sync command: `AI_COMMAND_CONTEXT_SYNC`.

### Local Development
1. `npm install`
2. `npm run dev`
3. Visit local app (typically `http://localhost:3000`)

### Build / Run
- `npm run build`
- `npm run start`

### Netlify Note
- Project originated from Netlify Next starter and includes Netlify-compatible support.

---

## 4) Systemd Deployment Notes

### Install Units
```bash
sudo cp /home/threejiptvweb/3j-tv/deploy/systemd/3j-tv.service /etc/systemd/system/3j-tv.service
sudo cp /home/threejiptvweb/3j-tv/deploy/systemd/3j-tv-scheduler.service /etc/systemd/system/3j-tv-scheduler.service
sudo cp /home/threejiptvweb/3j-tv/deploy/systemd/3j-tv-scheduler.timer /etc/systemd/system/3j-tv-scheduler.timer
sudo systemctl daemon-reload
sudo systemctl enable --now 3j-tv
sudo systemctl enable --now 3j-tv-scheduler.timer
```

### Required Env Files
`/etc/3j-tv/3j-tv.env`:
```bash
sudo mkdir -p /etc/3j-tv
sudo bash -lc 'cat > /etc/3j-tv/3j-tv.env <<EOF
ADMIN_DATA_KEY=REPLACE_ME
TMDB_API_KEY=REPLACE_ME
EOF'
sudo chmod 600 /etc/3j-tv/3j-tv.env
```

`/etc/3j-tv/scheduler.env`:
```bash
sudo mkdir -p /etc/3j-tv
sudo bash -lc 'cat > /etc/3j-tv/scheduler.env <<EOF
SCHEDULER_TOKEN=REPLACE_ME
EOF'
sudo chmod 600 /etc/3j-tv/scheduler.env
```

### Update / Restart After Code Changes
```bash
cd /home/threejiptvweb/3j-tv
sudo systemctl stop 3j-tv
npm run build:runtime
sudo systemctl start 3j-tv
sudo systemctl restart 3j-tv-scheduler.timer
```

### Logs
```bash
sudo journalctl -u 3j-tv -f
```

---

## 5) Canonical One-File Rule

For new AI chats, tell it to read:
- `/home/threejiptvweb/3j-tv/PROJECT_CONTEXT.md`

And require:
- `AI_COMMAND_CONTEXT_SYNC`
