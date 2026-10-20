# @sateais/sdk

[日本語](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/README.md) | **English**

The official JavaScript / TypeScript SDK for SateAIs. It provides async/await
programmatic access to the satellite image analysis APIs (ship detection,
oil slick detection, new / disappeared building detection, time-series change
detection, and land use / land cover classification). The currently supported
satellite is Sentinel-1 (Sentinel-2 + Sentinel-1 for land use / land cover only),
with additional satellites planned in future releases.

```bash
npm install @sateais/sdk
```

Zero dependencies (uses the standard `fetch`), dual ESM / CommonJS output, and
bundled type definitions (`.d.ts`). Runs on Node.js 18+ and modern browsers.

## Quickstart

```ts
import { Client } from "@sateais/sdk";

const client = new Client({ apiKey: process.env.SATEAIS_API_KEY });
const job = await client.analyze.ship({ scene_id: "S1A_IW_GRDH_..." });
const result = await client.jobs.wait(job.job_id); // poll until completion
console.log(result.features.length, "ships found");
```

## Authentication

API keys can be issued from the [SateAIs Console](https://console.spcsft.com).

Resolution order: `apiKey` argument > `SATEAIS_API_KEY` environment variable

```ts
// 1) Explicit
const client = new Client({ apiKey: "sk_live_xxxxx" });

// 2) Resolved automatically from the SATEAIS_API_KEY environment variable
const client = new Client();
```

```bash
export SATEAIS_API_KEY=sk_live_xxxxx
```

If the API key cannot be resolved, an `AuthenticationError` is thrown.

## Client options

Main options accepted by `new Client(options)`:

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `SATEAIS_API_KEY` env var | API key |
| `baseUrl` | `https://api.spcsft.com/api/v1` | API base URL (trailing slashes are stripped) |
| `timeoutMs` | `30_000` | Timeout **per request** (ms). `0` / negative disables it |
| `fetch` | global `fetch` | Replaceable fetch implementation |

> `Client`'s `timeoutMs` is a per-request timeout. It is distinct from `jobs.wait`'s
> `timeoutMs` (the overall wait until completion), so do not confuse the two.
> Passing `0` or a negative value disables the timeout (it does not abort immediately).

## SDK

### Analysis methods

| Method | Input pattern |
| --- | --- |
| `client.analyze.ship(...)` | `scene_id`, or `polygon`+`date` |
| `client.analyze.oilslick(...)` | Same as above |
| `client.analyze.newbuilding(...)` | `polygon`+`date_start`+`date_end` |
| `client.analyze.disappearbuilding(...)` | Same as above |
| `client.analyze.timeseries(...)` | Same as above |
| `client.analyze.lulc(...)` | `polygon`+`month` |

There are three input patterns:

```ts
// scene_id family (ship / oilslick): scene ID, or polygon + a single date
await client.analyze.ship({ satellite_id: "sentinel-1", scene_id: "S1A_IW_GRDH_..." });
await client.analyze.oilslick({
  satellite_id: "sentinel-1",
  polygon: "POLYGON((...))",          // WKT
  date: "2026-05-01",
  date_direction: "before",           // optional
  orbit_direction: "ascending",       // optional
});

// polygon + date range family (newbuilding / disappearbuilding / timeseries)
await client.analyze.timeseries({
  satellite_id: "sentinel-1",
  polygon: "POLYGON((...))",          // WKT
  date_start: "2026-01-01",
  date_end: "2026-05-01",
  orbit_direction: "ascending",       // optional
});

// polygon + base month family (lulc: land use / land cover)
await client.analyze.lulc({
  satellite_id: "sentinel-2",         // optional (always "sentinel-2" for lulc)
  polygon: "POLYGON((...))",          // WKT; its bounding box is analysed
  month: "2026-08",                   // last month of the 12-month period (even months only)
});
```

`satellite_id` is `"sentinel-1"` for every method except `lulc`, which uses
`"sentinel-2"` (both are filled in automatically when omitted). `lulc` combines
Sentinel-2 L2A and Sentinel-1 RTC imagery to classify every 10 m pixel into 15
classes, and returns a zip archive instead of GeoJSON (see
[Job management](#job-management)). The return value
is a `JobCreateResponse` (`job_id` / `status` / `created_at`, etc.). See the
[API reference](https://docs.spcsft.com/) for detailed parameters.

#### Input limits

The `polygon` area and the date range have server-side limits (jobs exceeding them are rejected with `ValidationError`).

| Method | Max area | Max range |
| --- | --- | --- |
| `newbuilding` / `disappearbuilding` | 30000 km² | — |
| `timeseries` | 50 km² | `date_start`–`date_end` within 3 years |
| `lulc` | 0.5–350 km² (area of the **bounding box**) | `month` must be an even month, `2018-02` or later, and already ended |

> `ship` / `oilslick` process a single scene, so they have no area limit. With `polygon`+`date`,
> the nearest scene within ±14 days of `date` is selected automatically.
>
> `lulc` classifies and bills the **whole bounding box** of your polygon, not the polygon
> itself. A long or diagonal polygon can have a small area but a large bounding box, so draw
> AOIs close to a rectangle. The analysis period is the 12 months ending with `month`
> (`"2026-08"` analyses 2025-09-01 to 2026-08-31).

### Pre-submission preview

`client.preview.<name>()` — same method names and parameters as the analysis
methods — returns the estimated credit consumption, your current balance, and the
AOI coverage without submitting a job. Previews consume no credits.

```ts
const preview = await client.preview.newbuilding({
  polygon: "POLYGON((...))",
  date_start: "2026-01-01",
  date_end: "2026-05-01",
});

console.log(preview.credits.estimated);  // estimated credit consumption (upper bound)
console.log(preview.credits.balance);    // current balance
console.log(preview.credits.sufficient); // whether the balance covers the estimate
console.log(preview.coverage?.ratio);    // scene coverage of the AOI (0.0–1.0)
console.log(preview.warnings);           // warnings such as LOW_AOI_COVERAGE
```

> - An insufficient balance is not an error (it is returned as
>   `credits.sufficient: false`). Actually submitting the job would fail with 402
>   (`InsufficientCreditsError`).
> - For inputs whose area is not determined (e.g. `scene_id`), credits cannot be
>   estimated: `credits.estimated` is `null` (with `CREDITS_NOT_ESTIMABLE` in `warnings`).
> - Actual consumption never exceeds the estimate (the estimate is an upper bound).
> - If the scene search fails or finds nothing, `coverage` is `null`.
> - For `lulc`, `coverage` is always `null` because the whole bounding box is classified,
>   and `area_sqkm` is the bounding-box area the job will be billed on.
> - A successful preview does not guarantee submission will succeed (e.g. the
>   concurrency limit may return 429).

### Job management

```ts
const job = await client.jobs.status(jobId);     // fetch the current state once
const geojson = await client.jobs.result(jobId); // result of a completed job (GeoJSON)

const geojson = await client.jobs.wait(jobId, {
  intervalMs: 60_000,                            // poll interval (default ~60s)
  timeoutMs: 3_600_000,                          // timeout, unlimited if omitted
  onPoll: (job) => console.log(job.status),      // callback on each poll
});
```

> Analysis can take 30–60 minutes. The default poll interval of `jobs.wait` is
> about 60 seconds accordingly.
>
> `jobs.wait` returns the result on `completed`, and throws `JobFailedError` to stop
> polling on `failed` and other terminal statuses such as `cancelled` / `expired`
> (including unknown statuses). `timeoutMs` is unlimited when omitted.

#### Jobs that return a zip archive (lulc)

`lulc` returns a zip archive instead of GeoJSON. Use `jobs.resultArchive` /
`jobs.waitArchive` to get the archive as bytes (`Uint8Array`). Polling options and
exceptions are the same as `jobs.wait`.

```ts
import { writeFile } from "node:fs/promises";

const job = await client.analyze.lulc({ polygon: "POLYGON((...))", month: "2026-08" });
const zip = await client.jobs.waitArchive(job.job_id); // poll until completion, then fetch the zip
await writeFile("lulc.zip", zip);

const zip2 = await client.jobs.resultArchive(jobId);    // zip of a completed job
```

| File in the archive | Description |
| --- | --- |
| `classes.tif` | Classified raster (`uint8`, single band, 10 m pixels in the AOI's UTM zone). Class IDs `1`–`15`, `0` = NoData. Colour map embedded |
| `class_stats.json` | Pixel count, area (km²) and share of each class that occurs |
| `legend.json` | ID, name (`name` in Japanese, `name_en` in English) and colour of all 15 classes |
| `visual.png` | Rendered map with a legend, for a quick visual check |

> - Tell the result format apart with `result_path` from `jobs.status()` (`result.geojson` / `result.zip`).
>   Calling `jobs.wait` on a zip job, or `jobs.waitArchive` on a GeoJSON job, throws `SateaisError`.
> - Calling `jobs.resultArchive` before the job completes throws `SateaisApiError` (409 `JOB_NOT_COMPLETED`).
> - Runtime is roughly 15 minutes to 2 hours depending on the area.
> - The model is built for Japan; results outside Japan have not been validated.

### Exceptions

All exceptions inherit from the base class `SateaisError`.

| Exception | Condition |
| --- | --- |
| `AuthenticationError` | 401 / 403, or unresolved API key |
| `ValidationError` | 400 (e.g. invalid required parameters) |
| `InsufficientCreditsError` | 402 (insufficient credits) |
| `NotFoundError` | 404 / 410 (including expired result retention) |
| `RateLimitError` | 429 (rate limited) |
| `SateaisApiError` | Other HTTP errors (holds `status` / `code` / `message`) |
| `ResponseParseError` | A 2xx response body is not JSON (holds `status`; transport / parse layer issue) |
| `JobFailedError` | Job failed / non-progress terminal status during `wait()` (holds `errorCode` / `errorMessage`) |
| `JobTimeoutError` | `wait()` timed out |

```ts
import { Client, JobFailedError, RateLimitError } from "@sateais/sdk";

try {
  const result = await client.jobs.wait(job.job_id);
} catch (err) {
  if (err instanceof JobFailedError) {
    console.error("analysis failed:", err.errorCode, err.errorMessage);
  } else if (err instanceof RateLimitError) {
    console.error("rate limit reached");
  } else {
    throw err;
  }
}
```

## ESM / CJS / TypeScript

- **ESM**: `import { Client } from "@sateais/sdk";`
- **CommonJS**: `const { Client } = require("@sateais/sdk");`
- **Bundled types**: `.d.ts` files ship with the package, so type completion works
  without any extra `@types/*`.

## Support

For technical inquiries, please contact [console-support@spcsft.com](mailto:console-support@spcsft.com).

## Related documents

- [docs/ARCHITECTURE.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/docs/ARCHITECTURE.md) — internal structure and design principles
- [docs/CONTRIBUTING.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/docs/CONTRIBUTING.md) — contributor guide
- [CHANGELOG.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/CHANGELOG.md) — change history

## License

MIT — see [LICENSE](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/LICENSE).
