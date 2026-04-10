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
  - Public IPTV streaming UI (Movies/Series/Live + immersive watch pages; `/` redirects to `/movies`)
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
- Public: `/login`, `/` (redirects to `/movies`), `/movies`, `/movies/[id]`, `/series`, `/series/[id]`, `/live` (nav label: `Live TV`), `/bookmarks`, `/request`, `/search`
- Public search: `/search` shows unified movie + series results. Header search category chips are merged into one combined `Categories` list and now open `/search?genre=<name>` instead of filling the text query. Genre-filtered results stay combined across movies + series and are sorted by TMDB popularity.
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
  - `/admin/autodownload/vpn`
  - `/admin/autodownload/settings`
  - `/admin/autodownload/autodelete/settings`
  - `/admin/autodownload/autodelete/movies`
  - `/admin/autodownload/autodelete/series`
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
- TMDB genre ranking endpoint: `/api/tmdb/genre-ranking` returns popularity-sorted TMDB discover rankings for a selected genre so public `/search?genre=...` can order local library matches by TMDB popularity.
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
  - per-job control endpoint `POST /api/admin/autodownload/downloads/control` supports `pause|resume|retry|delete|replace`; movie-job `delete` removes managed artifacts from Downloading/Cleaned and Ready/final library paths, and `replace` deletes the current managed movie then appends one fresh random movie into the same Movie Selection Log
  - bulk queue endpoint `POST /api/admin/autodownload/downloads/bulk` supports temporary admin bulk actions (currently `delete_all` for queue + qB cleanup); NAS library purge is safety-locked and requires explicit backend unlock + confirmation payload
  - scheduler tick endpoint `POST /api/admin/autodownload/scheduler/tick` supports optional scoped runs via body/query `type=movie|series|all`
  - qB WebUI password reveal endpoint `POST /api/admin/autodownload/download-settings/reveal-password` (requires active admin session + current admin password verification before returning decrypted password)
  - qB VPN endpoints:
    - `GET/PUT /api/admin/autodownload/download-settings/vpn`
    - `GET /api/admin/autodownload/download-settings/vpn/regions`
    - `POST /api/admin/autodownload/download-settings/vpn/apply`
    - `POST /api/admin/autodownload/download-settings/vpn/test`
    - `GET/POST /api/admin/autodownload/download-settings/vpn/internet` (background qB-user internet-over-VPN test with pollable job state/logs)
    - `GET/POST /api/admin/autodownload/download-settings/vpn/download` (background VPN-only qB 1GB download test with pollable job state/live qB progress)
    - `POST /api/admin/autodownload/download-settings/vpn/compare` (runs VPN-vs-no-VPN benchmark using one popular seeded movie source, then restores prior VPN state)

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
  - Public `settings.catalog` now stores category labels, page-layout rows, hero-carousel rules (source/count/sort criteria), and row behavior controls (top-row rotation cadence, display counts, pool sizes).
- `reports`, `notifications`
- `requestSettings` (daily limit default, per-username daily overrides, default landing category, customizable display labels for fixed request statuses)
- `requests` (one row per TMDB media id + media type, deduped globally, with requesters/reminder subscribers, status workflow, archive support)
- `upcomingReminders` (per TMDB media row reminder subscribers used by Worth-to-wait notifications)
- `engineHosts`, `mountSettings`, `mountStatus`
- `autodownloadSettings`
  - `autodownloadSettings.downloadClient.vpn` now stores qB-only VPN config/state (`enabled`, PIA credentials encrypted, region, kill-switch, dispatch guard, last apply/test summaries).
  - `autodownloadSettings.downloadClient.serviceUser/serviceGroup` now define the dedicated Linux account used by qBittorrent service (default `qbvpn`/`qbvpn`).
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
- Live TV page (`/live`) loads channels from `/api/xuione/live`, which uses XUI Admin `get_streams` plus XUI `get_categories` (configured via Admin Secrets) so channel rows show official live category names instead of raw category IDs. It only shows channels detected as online: the route filters to XUI “running” streams first (`stream_status`/`pid`), then optionally probes the actual stream URLs with a short in-memory TTL cache so stopped/down streams disappear on the next background poll (about every 15s) without a manual page reload. The route is served uncached (`Cache-Control: no-store`) and list/count updates are applied immediately even while the hero player is active. Channels are sorted by longest uptime first (best-effort via XUI PID ordering if no explicit uptime field exists), with any stored pinned IDs staying at the top. The hero is a movies-style full-bleed carousel: it shows **one representative channel per category** (the longest uptime channel; the user’s last selected channel in that category overrides the representative), rotates via arrows/dots/autoplay, and plays muted (no hero audio). Channels render below (peeking into the hero) as horizontal logo-only card strips grouped by category, with per-row previous/next scroll buttons like the movie rows.
- AutoDownload download/sync/control now opens an authenticated qB WebUI session using stored encrypted credentials (cookie-based login per SSH job) and treats HTTP/transport failures as hard errors instead of silent success.
- Download sync now enforces expected qB placement/category for managed items (`MOVIE_AUTO`/`SERIES_AUTO`, configured Downloading/Downloaded folders) using qB `setLocation` + `setCategory`.
- qBittorrent settings include a dedicated admin `qBittorrent Options` section on `/admin/autodownload/qbittorrent` for app-managed torrent lifecycle behavior only (`downloadClient.autoDeleteCompletedTorrents`, `autoDeleteCompletedDelayMinutes`); `Delete Delay (minutes)` is enforced by the app sync loop after completion (`deleteFiles=false`), while qB queue limits are no longer managed in this portal and should be edited directly in qB WebUI.
- Movie Selection Log modal now shows TMDB poster cards, status hover help, and admin `Replace` / `Delete` actions. `Replace` appends one new random movie into the same selection log, deletes the current managed movie artifacts, and starts the replacement download when possible. `Delete` removes the managed movie from queue/log counts and deletes managed artifacts from Downloading, `Cleaned and Ready`, or final library folders.
- qBittorrent connection edit modal now includes a `Show` action for WebUI password; revealing requires re-entering the currently logged-in admin password via `/api/admin/autodownload/download-settings/reveal-password`.
- qB VPN controls are now on dedicated `/admin/autodownload/vpn` page (under AutoDownload Settings nav), including setup notes/prerequisites, selected region/server details, runtime health checks, and test latency summary; apply/test actions are exposed via `/api/admin/autodownload/download-settings/vpn/*`.
- VPN page now also includes two dedicated diagnostics that run as pollable background jobs with live phase/log updates:
  - `VPN Internet Test` verifies that the qB service user can reach the internet over the VPN path, now reports both root-via-VPN and qB-user connectivity details, and marks the job as failed (not completed) when only the qB user path breaks.
  - `VPN Download Test` runs a standalone VPN-only qB download using an approximately `0.8GB–1.2GB` movie source, shows live torrent state/speed/seeds/peers, and cleans up the benchmark torrent afterward.
- VPN config now persists the latest VPN download-test result (`lastDownloadTestAt/Ok/Summary/Result`) so the VPN page can always show the last benchmark movie, seeders, VPN IP used, duration, avg/peak download+upload speeds, transfer totals, and final torrent state even after refresh/redeploy.
- qB VPN runtime checks validate the actual `qB user -> piawg0` route (`userRouteOk`) instead of only checking interface/iptables presence.
- qB VPN routing now uses the dedicated qB-user `uidrange` policy table as the primary enforcement path and populates LAN-bypass routes directly in that table; the previous owner-based iptables kill-switch path caused qB-user internet failures on this host and is now cleaned up during apply/disable.
- VPN page `Download Comparison (VPN vs No VPN)` now shows an in-page progress bar during benchmark runs; clicking the progress card opens a details modal with phase-by-phase status, elapsed time, and result metrics when complete.
- VPN page now includes a one-click download comparison benchmark (VPN OFF first, then VPN ON) using a latest popular movie source with high seeders; it auto-restores previous VPN state after both runs.
- VPN comparison hash detection now normalizes info-hashes, checks benchmark category and all torrents with source-hash/title fallbacks, and force-categorizes/resumes the matched torrent to avoid false `hash not detected` failures.
- VPN comparison now prefers magnet links for benchmark adds and returns expanded debug context on hash-detection failures (`addReply`, source hash, row counts, sample torrents) so troubleshooting is actionable from the UI error message.
- VPN comparison now requires **full completion** of the VPN run before starting the no-VPN run (sequential gate); sources are constrained to about `0.5GB–1.0GB`, and long-running/incomplete runs fail with explicit timeout/debug state instead of being marked as successful.
- On any comparison failure, benchmark torrents are auto-cleaned from qBittorrent (category/save-path based) before returning error so failed runs do not leave test downloads behind.
- Benchmark hash operations now use normalized lowercase info-hashes for qB API lookups/deletes (avoids case-sensitive misses), and metadata-stuck torrents fail fast with explicit state/seed/peer diagnostics.
- Benchmark runs now require real payload transfer; zero-byte/instant runs are treated as failures with detailed diagnostics instead of returning misleading `0 MB / 0s` success summaries.
- VPN comparison now retries with alternate benchmark sources (up to 3 attempts) when a source is unusable (metadata-stuck/no-payload/hash-miss/timeout) before surfacing a final failure.
- Benchmark link selection now prefers magnet links first (with same-source fallback link retry), and hash-detect add flow retries once with the alternate link before failing.
- qB API calls used by VPN benchmark now validate HTTP status + explicit `Fails.` auth responses and include raw response snippets/parse mode in `hash not detected` debug payload to speed up root-cause analysis.
- VPN benchmark still fast-fails when runs stay at no peers/seeds or metadata-only for too long.
- qBittorrent runtime now uses a dedicated Linux service account (`qbvpn` by default), isolated from XUI service users; provisioning auto-ensures save-path group/write compatibility so NAS stage writes continue to work after account migration.
- VPN routing is scoped to qBittorrent traffic only (dedicated qB service user) using policy routing + iptables mark chains; app/IPTV traffic remains on normal network.
- qB VPN routing now honors qB LAN allowlist CIDRs (`downloadClient.lanBind.authSubnetAllowlist`) as bypass destinations for mark/kill-switch chains so qB WebUI remains reachable on allowed LAN subnets while torrent traffic still routes through VPN.
- Scheduler and queue dispatch now run a VPN health guard (`downloadClient.vpn.requiredForDispatch`) and skip/start failures when VPN is required but not ready.
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
- Admin now includes `/admin/category-settings` to manage public category names, page layout, hero-carousel criteria, and category behavior (rotation cadence, visible-card counts, genre-row limits).
- On Movies/Series pages, `Worth to wait` is shown near the bottom of each page’s content stack (Movies: before the `All Movies` grid), and upcoming/released queue rows now hydrate missing poster/backdrop art from TMDB details by ID (cached) with `/placeholders/poster-fallback.jpg` as final fallback.
- Queue-backed upcoming movie cards now show a compact month/day release badge (`MMM D`); clicking those cards opens the preview modal directly (play-first bypass), and the modal’s top metadata line shows ratings first, then `Release date: <MMM D, YYYY>`, followed by genre/duration/year, plus description/cast and bottom-left `Remind me` + `More info` actions (red icon button via POST `/api/public/autodownload/upcoming`, action `remind`).
- Movie/Series detail pages support `?upcoming=1` mode for Worth-to-wait titles with TMDB metadata + trailer/cast + reminder action; released rows route back to normal detail pages.
- XUI catalog APIs now normalize `added` timestamps (`added/date_added/last_modified`) for VOD/Series rows and return no-store responses; Movies page `Recently Added` now sorts by that XUI-added time and polls every 60s so newly released XUI titles surface quickly.
- Public Movies and Series pages now use an admin-configurable hero carousel instead of a single featured card. Hero rules default to `5 recently added + 2 worth to wait + 3 top`, support `Latest` / `TMDB popularity` / `Reviews` sorting per source, dedupe overlapping titles, and the slider exposes persistent next/previous controls.
- Public Movies/Series poster cards now prefer app-proxied cached poster sources for non-TMDB artwork, use smaller TMDB `w342` posters for card views when available, and eagerly fetch the first visible row/grid posters with fade-in skeletons to reduce cold-browser first-load lag after login.
- Public Movies/Series catalogs no longer block the initial `/api/xuione/vod` and `/api/xuione/series` responses on TMDB artwork hydration. They now return immediately with cached/XUI artwork, then warm TMDB visuals plus a limited set of poster/backdrop originals in the background so cold refreshes do not sit behind synchronous TMDB lookups.
- Public Movies/Series catalog client cache persists the main `/api/xuione/vod` and `/api/xuione/series` payloads into browser session storage using opaque hashed cache keys. This reduces refresh-time hero delays where only queue-backed rows (for example `Worth to wait`) were available immediately.
- Public horizontal catalog rows now progressively render card batches instead of mounting the entire configured row immediately. This is important because category-layout settings can expose large rows (`Top Movies` 60, genre rows 20, etc.); initial render now caps card/image work and loads additional batches only as the user scrolls the row.
- Public poster-card source selection now always prefers the actual proxied/direct poster URL before the placeholder fallback. This avoids regressions where XUI poster cards render `No image available` immediately even though a valid `/api/xuione/image?...` source exists.
- All Movies grid now relies on its virtualization window plus native image lazy-loading rather than custom deferred batch gating. This avoids regressions where mid-window rows could stay blank or re-blank while scrolling. Hero slides also keep TMDB `posterPath/backdropPath` metadata as a fallback visual source so slides without a resolved backdrop do not render as blank sections.
- Queue-backed `Worth to wait` / `Leaving soon` rows now have their own short client+server caches, request media-type-specific payloads (`movie` vs `series`) instead of fetching a mixed queue and filtering on the client, and render with their own row-loading skeletons so those rows do not appear noticeably later than the main catalog rows after refresh.
- `Movies -> All Movies` now treats the first four rendered rows as eager artwork and prewarms poster URLs for the next two rows ahead of the current append window. This reduces the long image-skeleton gap after the initially visible `All Movies` rows while keeping the append-only grid behavior intact.
- Hero slides still strip XUI-provided trailing year suffixes from the featured title and render the heading as title-only (for example `The Da Vinci Code`, not `The Da Vinci Code (2006) (2006)`).
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
- Admin AutoDownload includes `/admin/autodownload/readiness` (AutoDownload Sanity Check) to run readiness checks across policy/scheduler, Engine Host, Mount, qBittorrent API + behavior options, source filters/providers, selection strategies, cleaning, timeout replacement, release hold, library routing, watchfolder trigger, XUI ingest, and optional VPN routing before end-to-end testing.
- AutoDownload readiness scoring now uses a shared `lib/autodownload/readinessModel.js` model so the sidebar badge and full Sanity Check page stay in sync; current checklist size is 17 items and the nav badge reads from `GET /api/admin/autodownload/readiness/summary`.
- The Sanity Check page must use `/api/admin/autodownload/readiness/summary` as the persisted source of truth for its score/cards/items instead of rebuilding readiness client-side from multiple API calls. Otherwise the page can drift from the sidebar badge when one supporting fetch partially fails.
- Watch Movie playback now starts with the direct VOD container URL (`/movie/.../{id}.{ext}`) and falls back to HLS only if needed; Series was already MP4/container-first, so Movies now follow the more stable VOD path too.
- `VideoPlayer` no longer proxies cross-origin direct file/container playback; only HLS manifests/segments/keys stay on `/api/proxy/hls`, so VOD MP4/MKV playback can bypass the Next.js proxy path entirely while HLS still works through same-origin rewriting.
- Auth/health server selection is now LAN-aware: when the request comes from a private/local network, `/api/auth/health` and `/api/auth/login` prefer private-IP XUI origins derived from configured Xuione hosts (served as `http://<private-ip>/`), while external requests keep the configured public origins.
- Watch pages (`movie`, `live`, `series`) now auto-align the in-browser session origin to the preferred local/public server returned by `/api/auth/health`, so an old session that was created on the public hostname is rewritten to the local XUI origin when the same user later browses from LAN.
- Local XUI VOD URLs can still 302 to public `tvN.3jxentro.net/vauth/...`; to avoid browser-side QUIC/CORB breakage on LAN playback, `VideoPlayer` now proxies private-host direct media/subtitle URLs through `/api/proxy/hls`, and the proxy manually follows redirects while rewriting public `tvN` redirects back to the resolved private IP when the upstream is LAN-local.
- Movie watch pages now disable HLS fallback when Xuione already reports a concrete container extension (`mp4`, `mkv`, etc.); for this panel, many movie `.m3u8` URLs redirect into `/vauth/...` HTML 404 responses, so HLS fallback was causing black-screen recovery loops instead of helping.
- AutoDownload qB dispatch is now less brittle when adding torrents: queue records prefer tracker-rich magnets over raw `.torrent` URLs when both exist, the dispatcher retries alternate source links before failing, and qB `torrents/info` probing waits longer (15s) before declaring `accepted add but torrent did not appear`.
- Scheduler ticks now consider already-queued retryable downloads even when no new selection run is due, so failed/queued AutoDownload rows can resume on the next minute tick instead of waiting until the next daily selection window.
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
  - optional: `XUI_ADMIN_BASE_URL`, `XUI_ADMIN_ACCESS_CODE`, `XUI_ADMIN_API_KEY`, `XUI_ADMIN_USERNAME`, `XUI_ADMIN_PASSWORD`
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

## 5) AutoDownload Duplicate Guardrails

- AutoDownload selection and queue dispatch must skip titles that already exist in the final NAS library inventory and must also check the XUI deployed catalog via admin API (`get_movies?limit=5000`, `get_series_list?limit=5000`) before starting a new download.
- Source selection must not rank torrents by quality/seeders alone for ambiguous titles. The selected source must match the requested TMDB title and year; otherwise it must be rejected and the system must try another source.
- Processing must fail fast on source/title mismatches so a wrong torrent cannot be cleaned, renamed, and released under another movie’s TMDB metadata.
- Movie Jobs actions are release-gated: `Replace` is locked once the title is already deployed in XUI or the scheduled release is within 5 hours; `Delete` is locked once deployed in XUI.
- Movie Jobs now show both torrent-added time and download-finished time in the `Added / Downloaded` column.
- If a completed movie reaches cleaning with a source/title mismatch, processing must route it into replacement/delete handling instead of leaving it stuck in `Completed`/`Processing`.
- Download rows must persist the exact qB source path (`sourceCleanupPath`) as soon as qB exposes the torrent name/save path, and sync must not blank that path on re-queue. Replace/Delete cleanup relies on it to remove stale folders from `Downloaded and Processing` even after qB has already auto-deleted the torrent.
- Timeout replacement must not append the same TMDB title back into the same Movie Selection Log. Existing `selectedItems` in that log are part of the dedupe set, and selection-log display should normalize duplicate `selectedItems` counts.
- Movie Jobs modal should hide superseded `Deleted` rows when a newer non-deleted row for the same TMDB exists in the same run, and status/help UI should not show redundant `?` icons when the browser hover title already explains the state.
- Public movie proxy for private XUI VOD should request `accept-encoding: identity`, avoid forwarding upstream `content-length` on streamed 206 responses, and normalize `accept-ranges` to `bytes`. This reduces browser `ERR_CONTENT_LENGTH_MISMATCH` stalls during long movie playback through `/api/proxy/hls`.
- OpenSubtitles is now supported as a movie-subtitle fallback. Admin Secrets must store `opensubtitlesApiKey`, `opensubtitlesUsername`, `opensubtitlesPassword`, and `opensubtitlesUserAgent`. `GET /api/xuione/vod/[id]` should append OpenSubtitles tracks only when XUI does not already provide subtitles, and browser subtitle tracks should point at `/api/subtitles/opensubtitles` which converts downloaded SRT content to WebVTT server-side.
- Admin Secrets UI is simplified for OpenSubtitles: only API key, username, and password are shown. `opensubtitlesUserAgent` remains supported internally but should default automatically (`3JTV v1.0`) unless there is a specific reason to override it in env/admin DB.
- Admin Secrets page uses a single `Edit Secrets` modal for all secret groups. Do not add per-row edit buttons back unless explicitly requested; labels/help text should live inside the modal form.
- Public movie subtitle order is now local-first: scan the NAS movie folder (via Engine Host + library inventory) for sidecar `.srt`/`.vtt` files and expose them through `/api/subtitles/local` before using XUI subtitle metadata, and only hit OpenSubtitles if neither local files nor XUI provide any track. This is specifically to reduce OpenSubtitles free-tier usage.
- Admin top navigation now shows a color-coded VPN status pill immediately left of the dark/light toggle. It polls `/api/admin/autodownload/download-settings/vpn` and should display `VPN Off`, `VPN Pending`, `VPN Issue`, or `VPN Active` using the most recent VPN error/test/apply summary as hover text.
- Storage & Mount now has two display sections: `NAS` (Mount Status, Folder Structure, Categories / Genres) and `Storage Devices` for the XUI VOD volume. Storage detection reads engine-host data from `/api/admin/autodownload/mount/storage-devices`, uses configurable `mountSettings.xuiVodPath` from the Storage & Mount settings modal, and falls back to detected `*/vod` candidates if the preferred path is missing. Show logical volume free space plus backing-device raw sizes; for combined/LVM/RAID storage, per-disk free space should be labeled as not directly measurable. This page is diagnostic/display-only for existing server folders, so status pills should use `Ready` / `Not Ready` / `Detected` instead of `Created`.
- VOD storage detection must remain resilient even when the live probe fails. The storage-devices route now falls back to the last known VOD snapshot from `deletionState.vodState`, and Storage & Mount should treat a resolved VOD path or non-zero logical size as `Detected` even if the live probe could not return a concrete block-device source. The SSH probe also treats a `findmnt -T` match as a valid VOD path even when a plain `[ -d ]` check would fail.
- The live VOD storage probe is relatively expensive on this engine host. `fetchVodStorageDevices()` now caches one in-flight/result snapshot for 60 seconds and uses a longer SSH timeout, so concurrent page loads (`Storage & Mount`, `AutoDelete`, deletion log preview) should share one probe instead of timing out separately. `AutoDelete Settings` should render immediately from `settings.storagePolicyVolume` / `deletionState.vodState` and let the richer `storage-devices` payload hydrate in the background instead of blocking the first paint.
- `fetchVodStorageDevices()` must execute one shared SSH probe per cache key. Do not start the probe twice against the same `SSHService` instance (for cache population and caller response separately), or `ssh2` can throw transport errors like `Bad packet length` / `ECONNRESET` even though the engine host itself is reachable.
- qBittorrent Delete Delay recovery: completed managed torrents can get stuck seeding if a row was previously marked `qbDeletedAt` without confirming the torrent actually disappeared. Auto-delete logic must confirm removal via qB API before setting `qbDeletedAt`, and sync must retry deletion when a torrent still exists even though the DB says `deleted` / `deleted_after_download` / `already_deleted` / `missing_in_client`.
- qBittorrent WebUI/API hash filters are case-sensitive on this host and expose hashes in lowercase. Any sync/delete confirmation path that queries `/api/v2/torrents/info?hashes=...` or `/api/v2/torrents/delete` must keep hashes lowercase; uppercasing hashes will produce false `deleted_after_download` confirmations while the torrent keeps seeding in qB.
- Selection-specific download gates and selection strategies are now edited from the selection pages, not from `AutoDownload Settings -> Limits & Timeouts`: `Movie Selection Log Settings` owns `maxMovieGb`, `minMovieSeeders`, and `movieSelectionStrategy`; `Series Selection Log Settings` owns `maxEpisodeGb`, `minSeriesSeeders`, `strictSeriesReplacement`, `deletePartialSeriesOnReplacementFailure`, and `seriesSelectionStrategy`. The admin settings route supports a `PATCH` with `section: "selection_rules"` for these page-local modals, and the Series Selection Log page/legacy alias route must render the same title/actions as Movies (`Series Selection Log`, `Trigger AutoDownload Once`, `Clear Log`).
- Series Selection Log row actions now match Movies for `Replace`, `Delete`, and `Details`. `Delete All` remains movie-only. Shared Selection Log UI/server copy must stay media-type aware so series actions never surface movie-specific lock/error text.
- Admin `Trigger AutoDownload Once` must not wait on the full scheduler cycle over one browser request. `/api/admin/autodownload/scheduler/tick` now supports background mode plus run-status polling, and the Selection Log UI should trigger that background run and poll until completion instead of sitting at `92%` while selection/dispatch/cleaning are still running.

---

## 6) Canonical One-File Rule

For new AI chats, tell it to read:
- `/home/threejiptvweb/3j-tv/PROJECT_CONTEXT.md`

And require:
- `AI_COMMAND_CONTEXT_SYNC`
- AutoDownload navigation is now split in the sidebar: `AutoDownload` keeps `Selection Log` plus the operational settings/pages, while `AutoDelete` is a separate top-level sidebar section directly below AutoDownload. Inside `AutoDelete`, `AutoDelete Settings` is a direct child and `Deletion Log` is a nested group with `Movies` and `Series`. AutoDelete routes are `/admin/autodownload/autodelete/settings`, `/admin/autodownload/autodelete/movies`, and `/admin/autodownload/autodelete/series`. The legacy `/admin/autodownload/deletion-log/*` routes now redirect into the new AutoDelete routes. The old `/admin/autodownload/movies` and `/admin/autodownload/series` routes still exist, but sidebar navigation should point to the grouped Selection Log routes. There is also a new admin activity page at `/admin/autodownload/activity` backed by XUI `activity_logs`.
- AutoDownload storage policy is now GB-based, not percent-first. `autodownloadSettings.storage.limitGb` is the primary limit, with legacy `storage.limitPercent` kept only as a fallback for old installs. New deletion settings live under `autodownloadSettings.deletion`: `enabled`, `triggerUsedGb`, `deleteBatchTargetGb`, `deleteDelayDays`, `protectRecentReleaseDays`, `protectRecentWatchDays`, and `pauseSelectionWhileActive`.
- Auto deletion settings are edited from the dedicated `AutoDelete Settings` admin page. `AutoDownload Settings` now keeps the storage guardrail, timeout checker, cleaning, and release controls only.
- Movie selection now enforces the GB-based storage guardrail entirely through `storagePolicy.limitUsedGb`. A stale reference to removed percent-era variables (`usedPct` / `limitPct`) caused zero-result Movie Selection Logs with `usedPct is not defined`; those historical empty logs were cleaned from admin DB.
- NAS-offline guardrail: `runMovieSelectionJob` already skips when the NAS mount is not writable, and now scheduler/dispatch must also pause managed qB torrents, skip queue dispatch, skip timeout deletion, skip cleaning, and skip release while the NAS mount is offline. Do not let `runTimeoutChecker()` convert active rows to `Deleted/Timeout` just because the NAS share is disconnected.
- The admin `Activity Logs` page now renders recent XUI VOD watch rows as a sortable, paginated table (`Type`, `Title`, `User`, `Started`, `Ended`) and limits `Top watched movies` / `Top watched series` to 10 items each, using TMDB backdrops when a TMDB id is available.
- The admin `Movies Deletion Log` / `Series Deletion Log` pages now use table-based layouts consistent with the Selection Log pages. The main run list is row-clickable and the modal details view is also rendered as a table instead of card rows.
- The `AutoDelete Settings` page now includes two storage charts: (1) an `XUI VOD Storage Thresholds` bar that uses the detected VOD volume (`/home/xui/content/vod` or the configured override) for deletion trigger/limit calculations, and (2) a separate `NAS Capacity` bar that shows current NAS usage only as reference. The trigger/limit chart uses a legend row under the bar so `Trigger` / `Limit` values do not overlap when the thresholds are close together.
- In `Edit AutoDelete Settings`, size-based fields use one decimal place. The modal shows the current maximum detected VOD storage as the basis, and the `Storage limit` / `Deletion trigger` inputs reveal range sliders when focused/clicked for faster selection. Storage limit validation/saving now also uses the detected VOD volume size as the primary max bound instead of the NAS mount total.
- `AutoDelete Settings` also treats current VOD used size as the minimum valid `Storage limit`. The UI slider/input start from current VOD usage, and the API rejects saving a storage limit below the current used size.
- The AutoDelete settings page must not collapse to `0.1 GB` defaults just because the dedicated storage-devices endpoint fails or the stored mount snapshot is stale. `GET /api/admin/autodownload/settings` now includes `storagePolicyVolume` resolved from the VOD volume, and the AutoDelete UI should fall back to that (and then to `deletionState.vodState`) when deriving current VOD total/used, storage limit, and deletion trigger defaults.
- AutoDelete Settings should not surface validation noise or editable `0.1 GB` sliders while VOD storage is still loading. The page now hydrates missing `storage.limitGb` / `deletion.triggerUsedGb` from the derived VOD policy in the settings API response, disables the edit/save controls when no VOD volume is detected, and falls back to `mountSettings.xuiVodPath` / `deletionState.vodState` for the resolved VOD path and usage snapshot.
- AutoDelete Settings now shows a fixed top-center loading spinner while the storage snapshot/bar chart data is loading or refreshing, because the VOD storage probe can take noticeable time on this host.
- AutoDelete now keeps a daily `deletionPreview` candidate set in the admin DB. The preview refreshes once per local day at `autodownloadSettings.deletion.previewRefreshTime` (default `00:00`, using the release/schedule timezone), uses VOD size as the primary delete-target basis, excludes already scheduled deletion rows, and respects the configured protection windows. Series only enter the preview when deployed series count is greater than `seriesEligibleThreshold`, and preview selection caps whole-series picks at `maxSeriesPerBatch`.
- AutoDelete preview generation must continue even when `autodownloadSettings.deletion.enabled` is `false`. The admin needs to see the next candidate set before turning AutoDelete on, so the scheduler/page-load path should not overwrite the preview with an empty `disabled` snapshot for the current cycle.
- Deletion preview generation must not block or fail just because the NAS share is offline/unwritable. When mount status is not writable, skip NAS `du/stat` enrichment and still build the preview from released candidates using available VOD/source-size metadata; SSH/VOD enrichment failures should degrade gracefully instead of blanking the preview.
- Deletion preview and actual trigger-time deletion do not share the same protection behavior. The daily/admin preview must stay strict (respect age/watch protections and skip rows where both NAS and VOD are missing). Only an actual trigger-time deletion cycle may bypass protections to satisfy storage pressure.
- The AutoDelete settings model/API now also owns `previewRefreshTime`, `seriesEligibleThreshold`, and `maxSeriesPerBatch`. The edit modal must show these as normal fields with info-tooltips beside the labels, not inline hint text.
- Movies/Series Deletion Log pages now show the current daily deletion preview above the table as wallpaper cards with both VOD and NAS detected sizes. When the VOD trigger is reached, the current preview is promoted into real deletion logs immediately, `Leaving Soon` becomes public from those logs, and the preview is regenerated right after scheduling for the next cycle.
- Movies/Series Deletion Log pages now render the daily deletion preview as a table, not wallpaper cards. Keep it consistent with the admin log/table style: title with image thumbnail, VOD size, NAS size, detected targets, protection flags, and last watched.
- Deletion preview/log visuals should not rely only on stored queue-row `tmdb.posterPath` / `tmdb.backdropPath`. Many older released rows have blank stored image paths. When preview candidates are built, backfill missing poster/backdrop paths from TMDB by `tmdbId` (cached) before rendering the image thumbnail.
- If the stored `deletionPreview` for the current cycle still contains placeholder poster images for titles that have a TMDB id, treat it as stale and rebuild that cycle’s preview so visual backfill changes can take effect without waiting for the next day.
- If the stored `deletionPreview` for the current cycle predates newer preview metadata (for example it lacks `protectionMode` / `diagnostics`) or still contains placeholder poster images for titles that have a TMDB id, treat it as stale and rebuild that cycle’s preview immediately.
- AutoDelete preview/deletion candidates must always skip rows where both NAS and VOD targets are missing. If strict protection windows produce zero eligible titles, the preview may bypass protections, but it must then prioritize the oldest TMDB release dates first (`release_date` for movies, `first_air_date` for series, with year-only fallback only if the full TMDB date is unavailable).
- Do not use internal AutoDelete/selection release dates when ranking deletion candidates. Candidate aging fallback may use internal library timestamps, but TMDB-priority bypass ordering must use TMDB release dates (or TMDB year fallback only if the full date is unavailable).
- AutoDelete preview must still check protection rules first. Only when strict protection filtering yields zero candidates may the preview bypass protections and fill the delete target from oldest TMDB release dates.
- AutoDelete scheduling/execution pauses while the NAS mount is offline or not writable, and due deletion logs resume automatically once the NAS is back online.
- AutoDelete has two distinct times: `previewRefreshTime` for rebuilding the next candidate set, and `deleteExecutionTime` for when due deletion logs are allowed to execute after the delay window.
- The Deletion Log page should reuse the current-cycle stored preview on normal page loads instead of forcing a fresh VOD storage probe each time; only rebuild when the preview is stale/missing.
- Admin top bar shows both `NAS` and `VPN` status pills; inactive states should render red so failures are obvious in light and dark themes.
- Real deletion logs now carry both `totalVodBytes` and `totalNasBytes`, and per-item details must expose VOD/XUI and NAS deletion states separately so the admin can tell whether the system deleted both copies or only one side.
- Admin form field hints/notes should not be rendered as inline text beside or under inputs anymore. For text fields and other form controls, place an info tooltip icon beside the field label and show the hint/note on hover. For table columns, keep hints on the header itself via hover tooltip/title instead of adding separate icon clutter.
- Scheduler now runs an auto-deletion cycle before selection/dispatch. When deletion mode is active and `pauseSelectionWhileActive` is true, movie/series selection and qB dispatch must be skipped with reason `deletion_active` until pending deletion logs are cleared.
- New deletion data lives in `db.deletionLogs` and `db.deletionState`. Each deletion log stores a scheduled run per media type with `deleteDate`, `storageSnapshot`, `triggerVolume`, `totalEstimatedBytes`, and per-item deletion state (`scheduled`, `deleting`, `deleted`, `failed`) including NAS/XUI deletion results.
- Public `Leaving Soon` titles come from `/api/public/autodownload/leaving-soon` and `/api/public/autodownload/leaving-soon/details`. Home / Movies / Series pages now show `Leaving Soon` rows, and movie/series detail pages query the details route to render a removal-date banner when a currently available title is scheduled for deletion.
- Auto deletion prioritizes oldest deployed titles from released AutoDownload rows, checks XUI One watch activity via admin API `activity_logs`, and uses a three-pass fallback: (1) avoid newly-added + recently-watched titles, (2) ignore recent-watch protection, (3) ignore both protections if storage pressure still requires deletion. Series deletions operate on whole-series rows only.
- Reminder subscribers are reused for deletion warnings: if a title already has upcoming/reminder subscribers in `db.upcomingReminders`, entering `Leaving Soon` should create a user notification (`type: leaving_soon`) exactly once per scheduled item.
- Admin Selection Log row `Replace` is no longer allowed to sit on one long browser request. `/api/admin/autodownload/downloads/control` now supports background replace jobs with status polling, and the Selection Log modal should show a staged progress bar while replace is running.
- Admin row `Replace` must delete the existing qB torrent first, confirm that qB actually removed it, clean managed files, then pick a new random title from the active selection strategy and dispatch that replacement.
- `runSelectionJobForType(... targetTotal: 1)` must act as a global cap across all strategy buckets, not just the first non-zero bucket. Replacement/single-pick selection should keep falling through later buckets until it finds one valid candidate or exhausts the strategy.
- Series source matching is not movie-style exact-title matching. TV torrent names commonly include `SxxExx`, `Season N`, `1x02`, or `Complete Season`; `sourceMatchesRequestedMedia(... type: 'series')` must strip those markers before comparing titles, and YTS should be treated as movie-only so series searches/retries/replacements do not accept YTS results.
- The active TPB mirror no longer guarantees the old `detLink` markup. TPB parsing must accept torrent-detail anchors without that class and must read size from the current right-aligned size cell, otherwise series source selection degrades into `Unknown title` / `no source found`.
- Manual series `Replace` now gets one relaxed fallback pass if strict selection finds no replacement: retry the same `targetTotal: 1` selection with `minSeedersOverride: 0` before declaring failure. This fallback is for manual replace only; it must not silently rewrite the normal series selection settings.
- Manual Selection Log `Replace` must not reuse the full heavy daily selection search envelope. Replacement runs now use tighter caps (`maxPagesPerBucket` / `maxCandidatesPerBucket`) so the admin either gets a replacement or a fast failure instead of sitting at `Selecting a new random series title` for minutes.
- Selection Log replace polling must fail visibly on auth loss or missing run status. Do not leave the progress bar frozen at an old phase like `62%`; mark the run failed and tell the admin to refresh/sign in again or inspect the latest queue state.
- Public catalog artwork now uses a lighter server-side cache path. Remote poster/backdrop originals are cached on disk under `data/.image-cache/originals-v1` through `/api/xuione/image`, while shared poster/hero components render those cached/local URLs with plain `<img>` elements instead of `next/image` to avoid pushing heavy image-transformation work onto the same Next.js process. Movies/Series catalog APIs plus Upcoming/Leaving Soon only warm a small priority set of poster/backdrop originals in the background.
- `Movies -> All Movies` no longer uses remove-and-remount viewport virtualization. It now renders append-only batches as the user scrolls, so rows already shown stay mounted and do not fall back to skeletal placeholders when the user scrolls away and back.
- Hero carousel no longer fires one `/api/tmdb/resolve-backdrop` request per slide on mount. It now stays on cached/XUI/TMDB-detail fallback visuals already present in the hero data path, which removes the live per-refresh backdrop request burst that was contributing to `3j-tv.service` memory pressure and crashes on `3000`.
- `/api/tmdb/resolve-backdrop` is now treated as a backward-compatibility safety net for stale clients: it keeps a short-lived in-memory cache/inflight dedupe and no longer logs each successful lookup, so leftover old-browser callers cannot keep hammering TMDB or flood the live logs.
- `Row` supports a priority mode that disables `content-visibility:auto` for selected catalog rows and increases eager poster fetches. Movies/Series use that for queue-backed `Leaving soon` and `Worth to wait`, so those lower-page rows can prepare earlier without reverting to the old “mount the entire row immediately” behavior everywhere.
