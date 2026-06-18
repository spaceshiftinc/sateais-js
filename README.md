# @sateais/sdk

**日本語** | [English](./README.en.md)

SateAIs の公式 JavaScript / TypeScript SDK です。SAR 衛星画像の解析 API
（船舶検出 / オイルスリック検出 / 新規・消失建物検出 / 時系列変化検出）に
async/await でプログラムからアクセスできます。
現在の対応衛星は Sentinel-1 で、今後順次拡張を予定しています。

```bash
npm install @sateais/sdk
```

依存ゼロ（標準 `fetch` を利用）・ESM / CommonJS デュアル出力・型定義（`.d.ts`）同梱。
Node.js 18+ およびモダンブラウザで動作します。

## クイックスタート

```ts
import { Client } from "@sateais/sdk";

const client = new Client({ apiKey: process.env.SATEAIS_API_KEY });
const job = await client.analyze.ship({ scene_id: "S1A_IW_GRDH_..." });
const result = await client.jobs.wait(job.job_id); // 完了までポーリング
console.log(result.features.length, "ships found");
```

## 認証

API キーは [SateAIs コンソール](https://console.spcsft.com) で発行できます。

優先度: `apiKey` 引数 > 環境変数 `SATEAIS_API_KEY`

```ts
// 1) 明示指定
const client = new Client({ apiKey: "sk_live_xxxxx" });

// 2) 環境変数 SATEAIS_API_KEY から自動解決
const client = new Client();
```

```bash
export SATEAIS_API_KEY=sk_live_xxxxx
```

API キーが解決できない場合は `AuthenticationError` が送出されます。

## クライアントオプション

`new Client(options)` で受け取れる主なオプション:

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `apiKey` | 環境変数 `SATEAIS_API_KEY` | API キー |
| `baseUrl` | `https://api.spcsft.com/api/v1` | API ベース URL（末尾スラッシュは自動除去） |
| `timeoutMs` | `30_000` | **1 リクエストあたり**のタイムアウト（ms） |
| `fetch` | グローバル `fetch` | 差し替え用の fetch 実装 |

> `Client` の `timeoutMs` は 1 リクエスト単位のタイムアウトです。`jobs.wait` の
> `timeoutMs`（完了までの全体待ち時間）とは別物なので混同しないでください。

## SDK

### 検出メソッド

| メソッド | 入力パターン |
| --- | --- |
| `client.analyze.ship(...)` | `scene_id`、または `polygon`+`date` |
| `client.analyze.oilslick(...)` | 同上 |
| `client.analyze.newbuilding(...)` | `polygon`+`date_start`+`date_end` |
| `client.analyze.disappearbuilding(...)` | 同上 |
| `client.analyze.timeseries(...)` | 同上 |

入力パターンは 2 系統あります。

```ts
// scene_id 系（ship / oilslick）: シーンID指定、または polygon + 単一日付
await client.analyze.ship({ satellite_id: "sentinel-1", scene_id: "S1A_IW_GRDH_..." });
await client.analyze.oilslick({
  satellite_id: "sentinel-1",
  polygon: "POLYGON((...))",          // WKT
  date: "2026-05-01",
  date_direction: "before",           // 任意
  orbit_direction: "ascending",       // 任意
});

// polygon + 期間 系（newbuilding / disappearbuilding / timeseries）
await client.analyze.timeseries({
  satellite_id: "sentinel-1",
  polygon: "POLYGON((...))",          // WKT
  date_start: "2026-01-01",
  date_end: "2026-05-01",
  orbit_direction: "ascending",       // 任意
});
```

`satellite_id` の現状の対応値は `"sentinel-1"` です。戻り値は `JobCreateResponse`
（`job_id` / `status` / `created_at` 等）。詳細パラメータは
[API リファレンス](https://docs.spcsft.com/) を参照してください。

### ジョブ管理

```ts
const job = await client.jobs.status(jobId);     // 現在の状態を1回取得
const geojson = await client.jobs.result(jobId); // 完了済ジョブの結果（GeoJSON）

const geojson = await client.jobs.wait(jobId, {
  intervalMs: 60_000,                            // ポーリング間隔（既定 約60s）
  timeoutMs: 3_600_000,                          // タイムアウト、未指定で無制限
  onPoll: (job) => console.log(job.status),      // 各ポーリング時のコールバック
});
```

> 検出には 30〜60 分かかる場合があります。`jobs.wait` の既定ポーリング間隔は
> これに合わせて約 60 秒です。

### 例外

すべての例外は基底クラス `SateaisError` を継承します。

| 例外 | 発生条件 |
| --- | --- |
| `AuthenticationError` | 401 / 403、または API キー未解決 |
| `ValidationError` | 400（必須パラメータ不正など） |
| `InsufficientCreditsError` | 402（クレジット不足） |
| `NotFoundError` | 404 / 410（結果の保持期限切れ含む） |
| `RateLimitError` | 429（レート制限） |
| `SateaisApiError` | 上記以外の HTTP エラー（`status` / `code` / `message` を保持） |
| `JobFailedError` | `wait()` 中にジョブが failed（`errorCode` / `errorMessage` を保持） |
| `JobTimeoutError` | `wait()` がタイムアウト |

```ts
import { Client, JobFailedError, RateLimitError } from "@sateais/sdk";

try {
  const result = await client.jobs.wait(job.job_id);
} catch (err) {
  if (err instanceof JobFailedError) {
    console.error("検出失敗:", err.errorCode, err.errorMessage);
  } else if (err instanceof RateLimitError) {
    console.error("レート制限に達しました");
  } else {
    throw err;
  }
}
```

## ESM / CJS / TypeScript

- **ESM**: `import { Client } from "@sateais/sdk";`
- **CommonJS**: `const { Client } = require("@sateais/sdk");`
- **型定義同梱**: `.d.ts` をパッケージに含むため、追加の `@types/*` なしで型補完が効きます。

## サポート

技術的なお問い合わせは [console-support@spcsft.com](mailto:console-support@spcsft.com) までご連絡ください。

## 関連ドキュメント

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 内部構造・設計方針
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) — 開発者向けガイド
- [CHANGELOG.md](./CHANGELOG.md) — 変更履歴

## ライセンス

MIT — [LICENSE](./LICENSE) 参照。
