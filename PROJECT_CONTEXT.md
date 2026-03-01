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
- Admin protected: `/admin`, `/admin/settings`, `/admin/secrets`, `/admin/admins`, `/admin/reports`
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
- Public requests: `/api/public/requests` (`GET` quota/settings/active request states, `POST` actions: `submit|state|remind`)
  - includes TMDB request catalog endpoint `GET /api/public/requests/catalog` (supports request-page browse/search/infinite-scroll with `include_adult=false` and genre filters)
  - includes TMDB/XUI series picker endpoint `POST /api/public/requests/series-options` (body: `tmdbId`, optional `streamBase` + title/year hints) that returns season/episode rows with TMDB still images and per-episode XUI availability tags for scoped requests
- AutoDownload: `/api/admin/autodownload/*` (engine, mount, download client, settings, processing, scheduler, xui, logs)
 - Request admin APIs:
   - `/api/admin/request-settings` (`GET`/`PUT`)
   - `/api/admin/requests` (`GET` queue + counts, `PATCH` actions: `status|archive`)
  - includes library inventory endpoint `GET/POST /api/admin/autodownload/library-inventory` (NAS scan cache of Movies/Series for duplicate checks + admin visibility)
  - includes source-provider health APIs under `/api/admin/autodownload/sources*`
  - source-provider endpoints include:
    - `POST /api/admin/autodownload/sources/:id/test`
    - `POST /api/admin/autodownload/sources/:id/validate`
    - `POST /api/admin/autodownload/sources/test-all`
    - `GET /api/admin/autodownload/sources/logs` (supports provider/domain/status/error filters)
    - `DELETE /api/admin/autodownload/sources/logs` (clear provider/all logs + reset domain health cache)
  - queue creation endpoint `POST /api/admin/autodownload/downloads` is TMDB-only (manual URL add is disabled in admin UI/API)
  - bulk queue endpoint `POST /api/admin/autodownload/downloads/bulk` supports temporary admin bulk actions (currently `delete_all`)
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
- `reports`, `notifications`
- `requestSettings` (daily limit default, per-username daily overrides, default landing category, customizable display labels for fixed request statuses)
- `requests` (one row per TMDB media id + media type, deduped globally, with requesters/reminder subscribers, status workflow, archive support)
- `engineHosts`, `mountSettings`, `mountStatus`
- `autodownloadSettings`
- `downloadsMovies`, `downloadsSeries`
- `processingLogs`, `selectionLogs`
- `sourceProviders`, `sourceProviderLogs`, `sourceProviderDomains`
  - `sourceProviderDomains` is the canonical per-domain/base health store (status, failure streak, backoff, last error, duration, ordering).
  - `sourceProviderDomainHealth` remains as a legacy compatibility array and is no longer authoritative.
- `libraryInventory` (persisted Movies/Series NAS snapshot for admin KPIs + duplicate checks)
- `xuiIntegration`, `xuiScanState`, `xuiScanLogs`

### Important Current Behaviors
- Scheduler orchestration: `lib/server/autodownload/schedulerService.js`
- Processing pipeline: `lib/server/autodownload/processingService.js`
- XUI debounced scan logic: `lib/server/autodownload/xuiService.js`
- qB provisioning/auth logic: `lib/server/autodownload/qbittorrentService.js`
- AutoDownload download/sync/control now opens an authenticated qB WebUI session using stored encrypted credentials (cookie-based login per SSH job) and treats HTTP/transport failures as hard errors instead of silent success.
- Download sync now enforces expected qB placement/category for managed items (`MOVIE_AUTO`/`SERIES_AUTO`, configured Downloading/Downloaded folders) using qB `setLocation` + `setCategory`.
- Queue-to-torrent binding now prefers strict source-hash matching and avoids fallback mis-linking when a source hash is known.
- Download source provider health/backoff/log orchestration: `lib/server/autodownload/sourceProvidersService.js`
- Provider adapter engine modules: `lib/server/autodownload/providers/*`, `sourceEngine.js`, `ranking.js`, `filters.js`
- AutoDownload staging folders are under `<mountDir>/qBittorrent/Movies` and `<mountDir>/qBittorrent/Series`; final library categories/genres stay under `<mountDir>/Movies` and `<mountDir>/Series`.
- CIFS mount orchestration now applies `uid/gid` ownership mapping (resolved to numeric IDs when needed) in test/mount/status auto-remount flows, preventing qB `Permission denied` writes on NAS-mounted `qBittorrent/*/1-Downloading`.
- AutoDownload Settings modal validates HH:MM schedule inputs client-side; valid times now correctly enable Save in `Edit Enable & Schedule`.
- AutoDownload Settings now include source-quality gates (`sourceFilters.minMovieSeeders`, `sourceFilters.minSeriesSeeders`) in addition to size limits.
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
- Scheduler now detects movie dispatch failures caused by size-limit rejections and runs an immediate supplemental movie selection (without updating daily `lastMoviesRunAt`) to replace rejected slots, then performs a follow-up movie dispatch pass for those replacements.
- YTS source links now prefer tracker-backed `.torrent` download URLs (with enriched magnet fallback), improving peer discovery vs legacy trackerless BTIH-only magnets.
- Movies/Series admin pages no longer expose any manual add action; queue seeding is automatic from selection strategy.
- Movies page now focuses on `Selection Log` only; clicking a run row opens a modal that contains the Movies jobs table (the previous Jobs-tab table is moved into this modal flow).
- Movies page no longer renders a single-item top subnav tab (`Selection Log`) to reduce redundant UI.
- Movies Selection Log modal is rendered above admin shell layers (sidebar/topbar) for full-focus inspection.
- Movies Selection Log includes temporary QA controls: `Trigger AutoDownload Once`, `Delete All` (queue + qB + optional NAS purge), and `Clear Log`.
- Movies jobs modal includes explicit size-rejection visibility via `Rejected by size limit` filter and `Size Rejected` row badge.
- Movie bulk delete flow is resilient to malformed qB `torrents/info` responses (JSON recovery + category-first query + fallback path) and, when NAS purge hits permission errors, retries cleanup with sudo on the Engine Host.
- Movie `Delete All` now also clears Movie Selection Log entries by default (same action call), and reports deleted log count in the success message.
- Movie NAS purge now retries non-empty directory cleanup loops before failing, reducing transient `Directory not empty` race errors on qB staging paths.
- AutoDownload includes `/admin/autodownload/library` (Library Inventory) with Movies/Series separation and KPI cards; inventory snapshots are persisted in DB (`libraryInventory`) for duplicate checking.
- Selection now pre-validates source availability during TMDB picks; candidates with no valid source are skipped and the engine keeps searching for alternatives.
- Dispatch now iterates past failed queued candidates (e.g., `No valid source found`) until it starts the per-type target count, instead of stopping at the first failed subset.
- Scheduler tick API no longer forces runs just because caller is an admin; force mode requires explicit `force=true`.
- Scheduled dispatch is tied to fresh selection runs (or explicit force), so automatic queue starts happen at selection schedule time rather than every timer tick throughout the day.
- `GET /api/admin/autodownload/downloads?type=movie|series` now performs first-run auto-seeding checks for both queues when empty (using `lastMoviesRunAt` / `lastSeriesRunAt`), so Movies/Series can populate without manual queue add.
- Selection engine supports both `runMovieSelectionJob` and `runSeriesSelectionJob`; scheduler ticks can run both or a scoped type (`movie`/`series`) for manual test triggers.
- AutoDownload Settings now include both Movie Selection Strategy and Series Selection Strategy blocks.
- XUI Watchfolder Trigger controls are managed from `/admin/autodownload/xui` (XUI Integration page), not `/admin/autodownload/settings`.
- XUI Scan state actions are simplified to `Manual Scan` (Movies/Series) and execute immediate manual scan requests.
- XUI integration watchfolder IDs support legacy keys (`watchFolderId`, `watchFolderIdMovie`) and normalize to `watchFolderIdMovies`/`watchFolderIdSeries`.
- Public request backend now enforces per-user daily quota (default `3`, with per-username overrides), dedupes by `mediaType + tmdbId`, supports reminder subscriptions, and exposes request-state lookups for request-card UI state.
- Public request backend state/submit flows now use authenticated XUI catalog checks (via `streamBase`) to mark already-available titles as `Available Now` and block duplicate request submissions for titles already in XUI.
- XUI availability detection for request cards now matches by TMDB id when present, with normalized title signatures (including compact/diacritic-safe forms and original title fallback) to improve `Available Now` tagging reliability.
- TV request entries now persist request-target metadata plus selected episode-number lists/units so admin queue/notifications keep scope context and series quotas can be enforced.
- Admin request backend now supports queue sorting by most requested first (`requestCount`), fixed status workflow (`pending`, `approved`, `available_now`, `rejected`, `archived`), and archive actions for completed/rejected cleanup.
- When request status transitions to `available_now`, notifications are pushed to all usernames in `reminderSubscribers`.
- Admin sidebar now includes dedicated `Requests` and `Request Settings` entries, with pages bound to `/api/admin/requests` and `/api/admin/request-settings`.
- Admin Requests Queue now supports row selection + bulk status transitions + bulk archive actions; backend `PATCH /api/admin/requests` accepts bulk `ids` for `action=status`.
- Admin Requests Queue status navigation now has quick filter links from KPI cards and row status badges (jump directly to matching queue filter tab).
- Request-card secondary status labels now render using customizable request status tags from Request Settings for consistent labeling across public/admin surfaces.
- Public `/request` page now includes TMDB infinite scroll, search + clear, horizontal genre filters (`Popular`, `Tagalog`, `Anime`, `Action`, `Adventure`, `Comedy`, `Horror`, `Romance`, `Drama`, `Sci-fi`), request-card states (`Available Now`, `Requested`, requestable), reminder modal action, and a floating request cart with daily-limit enforcement.
- Selected requestable cards on `/request` now show a full-card dark gradient overlay plus a larger top-right check badge for clearer selected-state visibility.
- Selecting a requestable series on `/request` now opens a TMDB-backed scoped picker with collapsible season rows and larger episode cards (TMDB still background); episodes already found in XUI are tagged `Available` and disabled, while `Request all missing episodes` auto-checks only not-yet-downloaded episodes up to the remaining per-day series quota.
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
