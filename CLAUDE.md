# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The repo holds two versions of the app. The web version is branded **VAT** (logo: a spreadsheet grid whose last column becomes an arrow; accent teal `#0F6B5E`; icons in `web/public/`). The desktop version is "Output VAT".

- **Web version (current):** `web/` (Vite + React + Tailwind on Netlify) and `server/` (Node 26 LTS + Fastify API in Docker on an Ubuntu server, reached through a Cloudflare Tunnel). Deployment, secrets and operations are in `DEPLOY.md`.
- **Desktop version (legacy):** the Electron app at the repo root, described further down.

Both turn an exported Excel sales report into an e-Faktur CSV. The web version reproduces the desktop output byte for byte without Microsoft Excel.

## Web version

### Commands

- `server/`, using npm:
  - `npm run dev` starts tsx watch. Use `ACCESS_MODE=off` locally; it is the default when `NODE_ENV` is not production.
  - `npm test` runs node:test over `test/*.test.ts`. Run one file with `node --test --import tsx test/formula.test.ts`.
  - `npm run typecheck`, `npm run build` (tsc into `dist/`).
  - `PARITY_DATA_DIR=../../output-vat-db [PARITY_HISTORY_DIR=…] [PARITY_ONLY=<regex>] npm run parity` runs the parity harness against real historical Excel outputs. The data is private and lives outside the repo.
  - `docker build --target test .` builds an image that runs the tests and the parity harness inside Linux.
- `web/`: `npm run dev` (Vite on :5173, proxies `/api` to :8080), `npm run build`, `npx netlify-cli deploy --prod --build`.

### Architecture

- **Engine** (`server/src/engine/`) is a pure function. The desktop pipeline was: fill the template, have Excel recalculate it, then convert to CSV. Here the Excel step is replaced by a built-in formula evaluator.
  - `fill.ts` is a 1:1 port of the desktop `parseExcelTemplate`, quirks included.
  - `csv.ts` is a 1:1 port of the CSV step, using the same `node-xlsx` version. It parses only the second sheet because the template's Data sheet is about 16k columns wide.
  - `recalc.ts` evaluates every formula and stores the results as cached values.
  - `formula/` contains the parser and evaluator for exactly the functions the templates use: IF, COUNTIF, ISNUMBER, INDIRECT, ADDRESS, ROW, COLUMN, TEXT, MONTH, YEAR, CONCATENATE, TRIM, ROUND/ROUNDDOWN/ROUNDUP, SUM, plus the `%` operator.
- **Engine invariants:**
  - Anything unsupported throws `UnsupportedFormulaError`. Templates are dry-run at upload time, so a template that would diverge from Excel is rejected rather than producing wrong numbers. Never silently approximate.
  - Excel semantics that matter:
    - Text dates are parsed as DMY (`DATE_ORDER` in `formula/dates.ts`, verified against history).
    - Number → text conversion uses 15 significant digits.
    - A reference to a blank cell yields 0.
    - Text comparison ignores case.
    - ROUND works on the decimal value, not the binary one.
- `engine/exceljs-patches.ts` fixes an exceljs 4.4.0 bug that writes a wrong `<dimension>` after rows are cleared, which made SheetJS read empty CSVs. Excel used to hide the bug by re-saving the file. Keep the patch imported wherever workbooks are written.
- **Untrusted-input limits:**
  - `engine/zipguard.ts` inflates every zip entry under a hard cap before exceljs runs, because Buffers bypass the worker heap limit.
  - `csv.ts` refuses any value containing `;`, CR or LF, because the CSV has no escaping.
  - COUNTIF wildcards use a linear matcher, not a RegExp.
  - SUM is capped at 2M cells.
- **Workers:** conversions run in `worker/` threads with heap and time limits. Results are copied before transfer, because pooled Buffers can't be transferred on Node 24+. In dev, workers start through `dev-bootstrap.mjs` because workers ignore `--import tsx`.
- **Auth layers**, all enforced in `app.ts`'s onRequest hook:
  1. Cloudflare Access protects both hostnames.
  2. The Netlify edge function (`web/netlify/edge-functions/api.ts`) verifies the user's Access JWT itself, plus the `x-ovat-edge` shared secret that a Cloudflare Transform Rule adds. Only then does it attach the service token and forward the JWT as `X-User-Access-Jwt`. No cookies are forwarded.
  3. The API verifies both JWTs (`auth/access.ts`) and checks the Origin header on non-GET requests. The user's identity is the verified Access email, which must also be on `ALLOWED_EMAILS`. Users are auto-created by email (`auth/identity.ts`); there are no app passwords or sessions.
- **Web routing:** `/` is a public landing page (`pages/Landing.tsx`, no API calls). The app lives under `/app` (`BrowserRouter basename="/app"`), and Access protects only `/app` and `/api`. Sign-out goes to `/cdn-cgi/access/logout`.
- **Storage:** SQLite (`node:sqlite`, migrations in `db.ts`) plus AES-256-GCM encrypted files (`storage.ts`, AAD = kind/id/part).
- Admin tasks (`list-users`, `import-template`) go through `server/src/cli.ts`.

## Desktop version (legacy)

"Output VAT" is a desktop app built with Electron, Create React App (TypeScript) and Tailwind. It reads an exported Excel sales report, maps its rows into a user-supplied Excel template, runs a user-supplied post-processing script on the result, and writes a semicolon-delimited CSV that is ready for VAT upload. The README is unmodified CRA boilerplate, so don't rely on it.

### Commands

The package manager is yarn (`yarn.lock`).

- `yarn dev`: starts the CRA dev server on :3000 and launches Electron against it once it is up. This is the normal way to develop. `yarn start` alone opens a plain browser, and the renderer crashes there because it calls `window.require` (see below).
- `yarn build`: production React build into `build/`, without sourcemaps.
- `yarn build:electron:win` / `yarn build:electron:mac`: build the React app, then package it with electron-builder into `dist/`.
- `yarn deploy:*`: the same, but publishes to GitHub Releases. electron-updater reads those releases for auto-update.
- `yarn test`: Jest through react-scripts, in watch mode. Run a single file with `CI=true yarn test src/App.test.tsx`, or filter by name with `-t "<name>"`.
  - The only test, `src/App.test.tsx`, is the unmodified CRA placeholder and fails: it looks for "learn react", and `window.require` does not exist in jsdom. Any real test has to mock `window.require` for `electron`, `fs`, `exceljs`, `child_process` and `node-xlsx`.
- Linting runs through CRA's built-in ESLint (`react-app` config) during start/build. There is no separate lint script. The VS Code settings format with Prettier on save.

### Architecture

**Main process:** `public/electron.js` (the `main` entry in package.json).
- Creates the window with `nodeIntegration: true`, `contextIsolation: false` and `webSecurity: false`. Dev mode loads `http://localhost:3000`, production loads `build/index.html`.
- Persists settings with `electron-store`.
- Handles the IPC channels `store-data` (replied to with `store-data-status`) and `restart_app`, and sends the auto-updater events `update_available` and `update_downloaded`.

**Settings flow:** the renderer never reads electron-store directly.
- On window creation, and after every `store-data` IPC, the main process copies the stored keys into the renderer's `localStorage` with `executeJavaScript`.
- The renderer reads those keys from `localStorage`: `excel-template`, `process-excel` and `use-reference-number`.
- To add a new persisted setting, add its key to `setLocalStorageDatabase()` in `electron.js` and write it through `ipcRenderer.send("store-data", JSON.stringify({id, value}))`.

**Renderer:** `src/`, using `HashRouter` (required for `file://` loading).
- The renderer loads Node and Electron modules with `window.require(...)` (`fs`, `path`, `child_process`, `electron`, `exceljs`, `node-xlsx`), not with `import`. This keeps webpack from trying to bundle them, so keep that pattern.
- `components/settings.components.tsx` stores the paths to the Excel template and to the process script (`.ps1` or `.sh`).
- `components/home.components.tsx` contains `parseExcelTemplate`, which holds all of the business logic:
  1. It reads the active sheet of the input file. Data starts at row 3, and invoice numbers are in column K.
  2. It copies input columns E–Z into template sheet `Data`, columns A–V. Whenever column C of the next input row is `"1"`, it skips a template row.
  3. On template sheet `DB`, it clears columns A–R from row `invoicesLength + 4` through row 2500. If "Use Reference Number" is on, it also sets the formula `DB!S = TRIM(Data!G…)`.
  4. It hides worksheets 0 and 2, then writes the workbook to a `tmp/` folder next to the template (`tmp-dev/` in development; both are gitignored).
  5. It runs the user's process script synchronously with the output path as its argument: PowerShell on Windows, a bash script on other platforms. The script is expected to open and re-save the file in Excel so that the formulas get computed.
  6. It reads the result back with `node-xlsx`, takes sheet index 1 (`DB`), pads each row to 21 columns, and writes a `;`-delimited `.csv` beside the `.xlsx`.
- The output-path code combines a `\\`-based split (`dir`) with a `/`-based split (`parentDir`). On Windows one of them comes out empty, and on macOS the other one does. Test any change to it on both platforms.
- `lib/file-operation.lib.js` contains small `fs` and `shell` helpers.

### Packaging notes

- Windows builds use NSIS (ia32 and x64), Linux builds use AppImage and deb, and the app ID is `com.stanleyowen.output-vat`.
- The top-level `extraFiles` entry in `package.json` sits outside the `build` key and points to `public/process_excel.ps1`, which does not exist in the repo. electron-builder therefore ignores it. Users supply the script through Settings instead.
