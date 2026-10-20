# WeYield layouts observed on the live app (2026-10-20)

Ground truth for `src/chart.js` and the test fixtures (`test/fixtures/weyield-layouts.js`). Observed on the live app on 2026-10-20 with the extension's own functions (`window.__WYP.findCharts`, `describe`, `autoRoles`, `readSeries`, `diagnose`), compared with WeYield's tooltips. One account, one filter state (all categories, stations and brands, 2026-10-13 to 2027-04-18), one day. Series names are assumed identical on other accounts.

Do not infer WeYield behaviour from the old README or from earlier mocks; when a fact is missing, see "Not verified" at the end.

**Routes in scope**, all under `/fr/app/<account>/operation/bookings/`:

- `bookings/lastyear` (tab "En portefeuille")
- `bookings/final` (tab "Final")
- `new-bookings/1-day`, `new-bookings/7-days` and `new-bookings/30-days` (page "Évolution des réservations")

## 1. Environment and data conventions

WeYield is an Angular app whose charts are Highcharts 10.3.3 instances.

- Each chart sits in an `<app-chart>` host. `window.Highcharts` is not exposed; the instance is reachable through `host.__ngContext__` (what `findChart` does). Series data is read with `series.xData` and `series.yData`.
- Every chart has a datetime x-axis with 188 daily points, 2026-10-13 to 2027-04-18 (the page's date filter). Timestamps are at UTC midnight.
- N-1 series share N's x values: WeYield aligns N-1 on the same weekday, 364 days earlier. Tooltip pairs confirm it: 4 Apr 2027 against 5 Apr 2026, and 18 Dec 2026 against 19 Dec 2025. Never realign by calendar year.
- `xAxis[0].options.plotBands` holds exactly one WeYield band: id `past-band`, from 1970-01-01 to the reference date (2026-10-19, matching the header "Date de référence"). The "?" markers at the top of the new-bookings charts are not in `options.plotBands`.
- Unnamed Highcharts series are called `Series 1`, `Series 2`, and so on. Every chart has some; they are helpers and must never become roles.
- The dash style is spelled `dash` on `bookings/` routes and `Dash` on `new-bookings/` routes. Treat any non-solid value as dashed.
- A series can exist with zero points: `lastyear` on `bookings/final` has none. It must count as absent.
- Area-range series (such as `availableFleet`) store `[low, high]` pairs in `yData`; they are never role candidates.

### Data quirks on `new-bookings/1-day` (second chart)

- `revenue` has 38 NaN and 1 `+Infinity` (2026-10-21); `ly_revenue` has 34 NaN and 5 `+Infinity` (first on 2027-02-09). In both series, the non-finite days are exactly the 39 days where net volume is 0 (0/0 gives NaN, x/0 gives Infinity).
- Net volume goes negative on 8 days (`thisyear`) and 1 day (`lastyear`); `revenue` is negative on 5 days.
- On `7-days` and `30-days`, both revenue series have 0 NaN and 0 Infinity. Windows of 2 to 6 days and 14, 21, 28, 60, 90 and 120 days were not checked.
- On `bookings/lastyear`, all RPJ and volume roles are finite on all 188 days.

### UI controls the extension reads

| Control | Where | DOM and values |
| --- | --- | --- |
| Window selector | `new-bookings/*`, under the heading "Évolution des réservations en 2026 vs 2025" | The page's only `[role=radiogroup]` of `input[type=radio]`, outside `app-new-bookings-variation-chart`. Values: 1 to 7 on `1-day` (labels "1 derniers jour", "2 derniers jours"…), 7/14/21/28 on `7-days`, 30/60/90/120 on `30-days`. The first is checked by default. |
| Metric dropdown | `bookings/*` | `a.dropdown-toggle.nav-link` whose text is "Avancé (Revenu par jour)". Its options are "Revenu Par Jour" and "RevCar". Absent on `new-bookings/*`. |
| Interval tabs | `new-bookings/*` | "Intervalles de 30 jours / 7 jours / 1 jour", linking to `/30-days`, `/7-days`, `/1-day`. |
| Reservation tabs | `bookings/*` | Évolution (`/new`), En portefeuille (`/lastyear`), Final (`/final`), Estimé et forecast (`/estimate`), Transactions (`/transactions`), Air Analytics (`/analytics`). Only `/lastyear` and `/final` were inspected. |
| Hidden loading headings | `bookings/*` | Two `<h3>` elements, `visibility:hidden`, text "Données en cours de chargement, merci de patienter quelques secondes..", 765 × 27 px. They sit nearer the chart than the visible page title, which is not an `h1` or `h2` ("Réservations"). `titleOf` skips them. |

### Tooltip semantics (these define what each series means)

- `bookings/*`: a header with the N date and the N-1 date, then rows "Flotte totale", "OnRent (jours)" and "Revenu par jour". Example on one date against its N-1 date (illustrative values): fleet 500 / 450, OnRent 30 / 38, Revenu par jour 40 € / 39 €.
- `new-bookings/*`, second chart: rows "OnRent net" and "Revenu par jour". Example on one date against its N-1 date, 1-day window (illustrative values): OnRent net +2 / +4, Revenu par jour 25 € / 26 €.

## 2. Page-by-page layout

The target: what the extension resolves on each route.

| Route | Chart to read | curVol | lyVol | lyfVol | curRpd | lyRpd | lyfRpd | kind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bookings/lastyear` | the only `app-chart` | `current` | `lastyear` | none | `currentRpd` | `lastyearRpd` | none | book |
| `bookings/final` | the only `app-chart` | `current` | none | `lastyearFinal` | `currentRpd` | none | `lastyearFinalRpd` | book |
| `new-bookings/1-day`, `7-days`, `30-days` | second chart (index 1) | `thisyear` | `lastyear` | none | `revenue` | `ly_revenue` | none | pace |

### bookings/lastyear

One `app-chart` is read. The market price box plot below it is a different component (`app-pi-prices-chart`), not an `app-chart`, and stays excluded. Axis 0 carries volumes and fleets, axis 1 the RPJ.

| # | Series | Type | Axis | Dashed | Role |
| --- | --- | --- | --- | --- | --- |
| 0 | `Series 1` | line | 0 | no | helper, ignore |
| 1 | `Series 2` | area | 0 | no | helper, a copy of `current` (grey fill) |
| 2 | `lastyear` | area | 0 | no | lyVol |
| 3 | `current` | line | 0 | no | curVol |
| 4 | `fleet` | line | 0 | no | fleet N, excluded by `notVol` |
| 5 | `availableFleet` | arearange | 0 | no | excluded |
| 6 | `lastYearReferenceFleet` | line | 0 | yes | fleet N-1, excluded |
| 7 | `lastYearAvailableReferenceFleet` | arearange | 0 | yes | excluded |
| 8 | `Series 9` | line | 1 | no | helper, ignore |
| 9 | `currentRpd` | line | 1 | no | curRpd |
| 10 | `lastyearRpd` | line | 1 | yes | lyRpd |

Illustrative spot values used by the fixtures on 2027-04-04: `Series 1` 400, `Series 2` 30, `lastyear` 38, `current` 30, `fleet` 500, `lastYearReferenceFleet` 450, `Series 9` 35, `currentRpd` 40, `lastyearRpd` 39. (The fixtures use fictitious numbers; only names, types, axes, dash styles, point counts and non-finite patterns come from the live app.)

### bookings/final

One `app-chart`, with the same price box plot below it. There are 9 named series and 4 anonymous ones; the series order was not captured.

| Series | Type | Axis | Dashed | Points | Role |
| --- | --- | --- | --- | --- | --- |
| `lastyear` | line | 0 | no | **0** | absent: zero points, so no N-1 roles |
| `lastyearFinal` | area | 0 | yes | 188 | lyfVol |
| `current` | line | 0 | no | 188 | curVol |
| `fleet` | line | 0 | no | 188 | excluded |
| `availableFleet` | arearange | 0 | no | 188 | excluded |
| `lastYearFleet` | line | 0 | yes | 188 | excluded |
| `lastYearAvailableFleet` | arearange | 0 | yes | 188 | excluded |
| `currentRpd` | line | 1 | no | 188 | curRpd |
| `lastyearFinalRpd` | line | 1 | yes | 188 | lyfRpd |

### new-bookings/\*, first chart ("Évolution des réservations")

The host is an `app-chart` inside `app-new-bookings-chart`. It draws the stacked evolution of the booking stock. It has no RPJ series and no N-1 series, so only `current` can fill a role (curVol).

| Route | Series | Anonymous | `delta` | Others |
| --- | --- | --- | --- | --- |
| `1-day` | 25 | 15 | 7 (keys `delta`, `delta#2` to `delta#7`) | `current` (line), `fleet` (line), `availableFleet` (area type) |
| `7-days` | 16 | 9 | 4 | same three |
| `30-days` | 16 | 9 | 4 | same three |

### new-bookings/\*, second chart ("Évolution des réservations en 2026 vs 2025")

The host is an `app-chart` inside `app-new-bookings-variation-chart`. It shows net pickup over the window chosen in the radio group. The four series are identical on the three routes, so `chartKey` is `fu2an` on all of them.

| Series | Type | Y-axis index | Dashed | Meaning | Role |
| --- | --- | --- | --- | --- | --- |
| `thisyear` | area | 0 | no | net OnRent days gained in the window, N | curVol |
| `lastyear` | area | 0 | yes (`Dash`) | same, N-1 | lyVol |
| `revenue` | line | 1 | no | RPJ of those net bookings, N, in €/day | curRpd |
| `ly_revenue` | line | 1 | yes (`Dash`) | same, N-1 | lyRpd |

Illustrative spot values on 2026-12-18 with the 1-day window (fixtures): `thisyear` 2, `lastyear` 4, `revenue` 25, `ly_revenue` 26. There is no N-1 final series on this chart.

## 3. Not verified

- **RevCar mode.** The series names and values on `bookings/*` after switching the "Avancé" menu to "RevCar" are unknown. The extension shows no RPJ in that mode until it is recorded here (see check A6 in the README).
- **Other routes.** `bookings/new`, `/estimate`, `/transactions`, `/analytics`, `booking-pace`, `forecast`, `treemaps` and `advance-bookings` were not inspected. `findCharts` still tries any `app-chart` with a datetime axis there, so expect wrong or empty reads until they are observed.
- **Other windows.** Only the default window of each interval page was inspected. Windows of 2 to 6 days and 14, 21, 28, 60, 90 and 120 days were not checked for NaN / Infinity. `agg` ignores every non-finite value regardless.
- **Negative RPJ.** `revenue` is negative on 5 days of the 1-day window, and the meaning is unknown (possibly cancellations with a negative net revenue). Negative values are not clipped; whether to clip or exclude is a product decision.
- **Anonymous series.** `Series 2` equals `current` (the grey fill); `Series 1` and `Series 9` on `bookings/lastyear` are unidentified. They never match a role, so they are harmless.
- **Pace thresholds.** The `T` values in `signals.js` (7 % and 20 % steps, `minCoverage`, `thinVol`) were set for portfolio volumes. On a 1-day window the net volumes are tiny (in the fixtures, 20–26 Oct: −1.4 net days for N against 23.8 for N-1), so percentages swing widely. To recalibrate with the 👍/👎 journal.
- **The "?" markers.** How WeYield draws them is unknown; they are not in `options.plotBands`. The 16 px label offset on `new-bookings/*` is a guess to confirm visually.
