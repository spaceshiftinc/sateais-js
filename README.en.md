# @sateais/sdk

[日本語](https://github.com/spaceshiftinc/sateais-js/blob/v0.1.0-rc.1/README.md) | **English**

The official JavaScript / TypeScript SDK for SateAIs. It provides async/await
programmatic access to the SAR satellite image analysis APIs (ship detection,
oil slick detection, new / disappeared building detection, and time-series change
detection). The currently supported satellite is Sentinel-1, with additional
satellites planned in future releases.

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
| `timeoutMs` | `30_000` | Timeout **per request** (ms) |
| `fetch` | global `fetch` | Replaceable fetch implementation |

> `Client`'s `timeoutMs` is a per-request timeout. It is distinct from `jobs.wait`'s
> `timeoutMs` (the overall wait until completion), so do not confuse the two.

## SDK

### Analysis methods

| Method | Input pattern |
| --- | --- |
| `client.analyze.ship(...)` | `scene_id`, or `polygon`+`date` |
| `client.analyze.oilslick(...)` | Same as above |
| `client.analyze.newbuilding(...)` | `polygon`+`date_start`+`date_end` |
| `client.analyze.disappearbuilding(...)` | Same as above |
| `client.analyze.timeseries(...)` | Same as above |

There are two input patterns:

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
```

The currently supported `satellite_id` value is `"sentinel-1"`. The return value
is a `JobCreateResponse` (`job_id` / `status` / `created_at`, etc.). See the
[API reference](https://docs.spcsft.com/) for detailed parameters.

#### Input limits

The `polygon` area and the date range have server-side limits (jobs exceeding them are rejected with `ValidationError`).

| Method | Max area | Max range |
| --- | --- | --- |
| `newbuilding` / `disappearbuilding` | 30000 km² | — |
| `timeseries` | 50 km² | `date_start`–`date_end` within 3 years |

> `ship` / `oilslick` process a single scene, so they have no area limit. With `polygon`+`date`,
> the nearest scene within ±14 days of `date` is selected automatically.

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
| `JobFailedError` | Job failed during `wait()` (holds `errorCode` / `errorMessage`) |
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

- [docs/ARCHITECTURE.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.1.0-rc.1/docs/ARCHITECTURE.md) — internal structure and design principles
- [docs/CONTRIBUTING.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.1.0-rc.1/docs/CONTRIBUTING.md) — contributor guide
- [CHANGELOG.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.1.0-rc.1/CHANGELOG.md) — change history

## License

MIT — see [LICENSE](https://github.com/spaceshiftinc/sateais-js/blob/v0.1.0-rc.1/LICENSE).
