# @sateais/sdk

**日本語** | [English](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/README.en.md)

SateAIs の公式 JavaScript / TypeScript SDK です。衛星画像の解析 API
（船舶検出 / オイルスリック検出 / 新規・消失建物検出 / 時系列変化検出 /
土地利用・土地被覆分類）に async/await でプログラムからアクセスできます。
現在の対応衛星は Sentinel-1（土地利用・土地被覆分類のみ Sentinel-2 + Sentinel-1）で、
今後順次拡張を予定しています。

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
| `timeoutMs` | `30_000` | **1 リクエストあたり**のタイムアウト（ms）。`0` / 負値で無効化 |
| `fetch` | グローバル `fetch` | 差し替え用の fetch 実装 |

> `Client` の `timeoutMs` は 1 リクエスト単位のタイムアウトです。`jobs.wait` の
> `timeoutMs`（完了までの全体待ち時間）とは別物なので混同しないでください。
> `0` または負値を指定するとタイムアウトを無効化します（即時 abort にはなりません）。

## SDK

### 検出メソッド

| メソッド | 入力パターン |
| --- | --- |
| `client.analyze.ship(...)` | `scene_id`、または `polygon`+`date` |
| `client.analyze.oilslick(...)` | 同上 |
| `client.analyze.newbuilding(...)` | `polygon`+`date_start`+`date_end` |
| `client.analyze.disappearbuilding(...)` | 同上 |
| `client.analyze.timeseries(...)` | 同上 |
| `client.analyze.lulc(...)` | `polygon`+`month` |

入力パターンは 3 系統あります。

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

// polygon + 基準月 系（lulc: 土地利用・土地被覆分類）
await client.analyze.lulc({
  satellite_id: "sentinel-2",         // 任意（lulc は "sentinel-2" 固定）
  polygon: "POLYGON((...))",          // WKT。バウンディングボックスが解析対象
  month: "2026-08",                   // 12 ヶ月の解析期間の最終月（偶数月のみ）
});
```

`satellite_id` は `lulc` 以外では `"sentinel-1"`、`lulc` では `"sentinel-2"` です
（省略時はそれぞれ自動で補完されます）。`lulc` は Sentinel-2 L2A と Sentinel-1 RTC を
併用して 10m 画素ごとに 15 クラスへ分類し、結果は GeoJSON ではなく zip で返ります
（[ジョブ管理](#ジョブ管理) を参照）。戻り値は `JobCreateResponse`
（`job_id` / `status` / `created_at` 等）。詳細パラメータは
[API リファレンス](https://docs.spcsft.com/) を参照してください。

#### 入力上限

`polygon` の面積と期間には API 側の上限があります（超過時はジョブ投入が `ValidationError` で拒否されます）。

| メソッド | 面積上限 | 期間上限 |
| --- | --- | --- |
| `newbuilding` / `disappearbuilding` | 30000 km² | — |
| `timeseries` | 50 km² | `date_start`〜`date_end` は 3 年以内 |
| `lulc` | 0.5〜350 km²（**バウンディングボックス**の面積） | `month` は偶数月のみ・`2018-02` 以降・終了済みの月 |

> `ship` / `oilslick` は単一シーン処理のため面積上限はありません。`polygon`+`date` 指定時は
> `date` を基準に ±14 日以内で最も近いシーンを自動選択します。
>
> `lulc` は `polygon` そのものではなく **バウンディングボックス全体** を分類・課金します。
> 細長い・斜めのポリゴンは面積が小さくてもバウンディングボックスが大きくなるため、
> AOI は矩形に近い形で指定してください。解析期間は `month` で終わる 12 ヶ月です
> （`"2026-08"` なら 2025-09-01〜2026-08-31）。

### 投入前プレビュー

検出メソッドと同名・同パラメータの `client.preview.<name>()` で、ジョブを投入せずに
消費クレジットの見積もり・残高・AOI カバレッジを確認できます。プレビューでクレジットは
消費されません。

```ts
const preview = await client.preview.newbuilding({
  polygon: "POLYGON((...))",
  date_start: "2026-01-01",
  date_end: "2026-05-01",
});

console.log(preview.credits.estimated);  // 消費クレジットの見積もり（上限値）
console.log(preview.credits.balance);    // 現在の残高
console.log(preview.credits.sufficient); // 残高が見積もりに対して十分か
console.log(preview.coverage?.ratio);    // AOI のシーン被覆率（0.0〜1.0）
console.log(preview.warnings);           // LOW_AOI_COVERAGE などの警告
```

> - 残高不足はエラーになりません（`credits.sufficient: false` として返ります）。
>   実際にジョブを投入した場合は 402（`InsufficientCreditsError`）になります。
> - `scene_id` 指定など面積が確定しない入力ではクレジットを見積もれず、
>   `credits.estimated` は `null`（`warnings` に `CREDITS_NOT_ESTIMABLE`）になります。
> - 実際の消費クレジットが見積もりを上回ることはありません（見積もりは上限値）。
> - シーン検索が失敗・該当なしの場合、`coverage` は `null` になります。
> - `lulc` はバウンディングボックス全体を分類するため `coverage` は常に `null` で、
>   `area_sqkm` はバウンディングボックスの面積（課金対象の面積）です。
> - プレビューが通ってもジョブ投入時に失敗する場合があります（同時実行上限 429 など）。

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
>
> `jobs.wait` は `completed` で結果を返し、`failed` および `cancelled` / `expired`
> などの終端ステータス（未知のステータスを含む）では `JobFailedError` を送出して
> ポーリングを止めます。`timeoutMs` は未指定で無制限です。

#### zip で結果を返すジョブ（lulc）

`lulc` の結果は GeoJSON ではなく zip です。`jobs.resultArchive` / `jobs.waitArchive` で
zip のバイト列（`Uint8Array`）を取得します。ポーリングのオプションと例外は `jobs.wait` と同じです。

```ts
import { writeFile } from "node:fs/promises";

const job = await client.analyze.lulc({ polygon: "POLYGON((...))", month: "2026-08" });
const zip = await client.jobs.waitArchive(job.job_id); // 完了までポーリングして zip を取得
await writeFile("lulc.zip", zip);

const zip2 = await client.jobs.resultArchive(jobId);    // 完了済ジョブの zip を取得
```

| zip 内のファイル | 内容 |
| --- | --- |
| `classes.tif` | 分類ラスタ（`uint8`・1 バンド・10m 画素、AOI の UTM 座標系）。クラス ID `1`〜`15`、`0` は NoData。カラーマップ埋め込み済み |
| `class_stats.json` | 出現したクラスごとの画素数・面積（km²）・割合 |
| `legend.json` | 全 15 クラスの ID・名称（`name` 日本語 / `name_en` 英語）・色 |
| `visual.png` | 凡例付きの描画画像（目視確認用） |

> - 結果の形式は `jobs.status()` の `result_path`（`result.geojson` / `result.zip`）で判別できます。
>   `jobs.wait` を zip のジョブに、`jobs.waitArchive` を GeoJSON のジョブに使うと `SateaisError` になります。
> - 未完了のジョブに `jobs.resultArchive` を呼ぶと `SateaisApiError`（409 `JOB_NOT_COMPLETED`）になります。
> - 処理時間は面積に応じて 15 分〜2 時間程度です。
> - モデルは日本向けに学習されており、日本国外の結果は検証されていません。

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
| `ResponseParseError` | 2xx 応答のボディが JSON でない（`status` を保持。transport / パース層の問題） |
| `JobFailedError` | `wait()` 中にジョブが failed / 終端外ステータス（`errorCode` / `errorMessage` を保持） |
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

- [docs/ARCHITECTURE.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/docs/ARCHITECTURE.md) — 内部構造・設計方針
- [docs/CONTRIBUTING.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/docs/CONTRIBUTING.md) — 開発者向けガイド
- [CHANGELOG.md](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/CHANGELOG.md) — 変更履歴

## ライセンス

MIT — [LICENSE](https://github.com/spaceshiftinc/sateais-js/blob/v0.2.0/LICENSE) 参照。
