# Architecture

`@sateais/sdk`（JavaScript / TypeScript SDK）の内部構造ドキュメント。

## 設計方針

姉妹リポ [`sateais-py`](../../sateais-py/) の **軽量 Hexagonal 構成**に倣い、
SDK 規模に対する過剰設計を避けつつ、唯一テストで差し替え価値の高い
HTTP 通信だけを Port（interface）で抽象化しています。

JS 版固有の方針:

- **ランタイム依存ゼロ** — 標準 `fetch` のみを利用（Node.js 18+ / モダンブラウザ）
- **ESM + CommonJS デュアル出力** + `.d.ts` 型定義同梱（`tsup`）
- **CLI は MVP スコープ外**（`sateais-py` は SDK + CLI だが本リポは SDK のみ）

## ファイル構成

```
src/
├── index.ts       # public API の再エクスポート（エントリポイント）
├── types.ts       # DetectionEndpoint, 検出パラメータ型, JobCreateResponse,
│                  #   JobStatusResponse, GeoJSONResponse
├── errors.ts      # 例外階層
├── http.ts        # ApiClient interface + HttpApiClient（唯一の I/O 抽象境界）
└── client.ts      # Client + Detection（検出）+ Jobs（ユーザー向けファサード）
```

検出（`client.ship` など）とジョブ操作（`client.jobs`）は `client.ts` に同居させ、
`sateais-py` の `_client.py`（Client + Detect + Jobs）に倣ってファイル数を抑えています。

## 依存方向

```
index.ts
    ↓
client.ts                  (delivery — Client ファサード / 検出 / Jobs)
    ↓
http.ts                    (ApiClient interface + HttpApiClient)
    ↓
types.ts , errors.ts       (entities / exceptions, 外部依存なし)
```

ルール:

- `types.ts` / `errors.ts` は外部依存なし（標準のみ）。ここに `fetch` を持ち込まない
- `http.ts` は `fetch`・通信・リトライ・タイムアウト・エラーマッピングをここに閉じ込める
- `client.ts` / `index.ts` がすべてを結線する composition root

## HTTP クライアントの抽象境界（Port）

唯一の I/O 抽象境界として `ApiClient` interface を切り、テストで差し替え可能にします。

```ts
// http.ts
export interface ApiClient {
  submitDetection(
    endpoint: DetectionEndpoint,
    params: Record<string, unknown>,
  ): Promise<JobCreateResponse>;
  getJob(jobId: string): Promise<JobStatusResponse>;
  getJobResult(jobId: string): Promise<GeoJSONResponse>;
}
```

`HttpApiClient` が標準 `fetch` を用いた具体実装で、以下を担います:

- Bearer 認証ヘッダ（`Authorization: Bearer <apiKey>`）と `Content-Type: application/json` の付与
- タイムアウト（`AbortController`）
- 指数バックオフ・リトライ（`429` / `5xx` / `504`、開始 1s・上限 30s・最大 5 回）。
  `4xx`（`VALIDATION_ERROR` 等）はリトライせず即時失敗
- `NaN` を含むレスポンスの安全パース（`:\s*NaN` → `null` 置換。Python 側 `float('nan')` 対策）
- エラー envelope（`{ "error": { "code", "message" } }`）→ 例外へのマッピング

`Client` は `ApiClient` を受け取って動くため、テストでは Fake 実装を注入できます
（test Issue の `fetch` モック方針と整合）。

## Port の使い分け

### Port を切ったもの: `ApiClient`

- テスト時に HTTP 通信を完全に排除した Fake で網羅できる
- 将来 gRPC / Mock サーバ / Replay 機構など、別 transport を足す余地が現実的にある

### Port を切らなかったもの

| 機能 | 対処 | 理由 |
| --- | --- | --- |
| タイマー（`setTimeout`） | 直接呼ぶ | テストは Vitest の fake timers で十分 |
| 環境変数（`SATEAIS_API_KEY`） | コンストラクタで読むだけ | テストは引数 `apiKey` で渡せる |

**判断基準**: 「将来差し替える可能性が現実的にあるか？」「テストで困るか？」の両方が
弱い場合は interface を作らず具体実装を使う。

## 検証ロジックの置き場所

検出リクエストの必須パラメータの組合せ検証は、各検出メソッドが submit 直前に行います
（`scene_id` 系か `polygon`+期間 系かの判別）。不正な組合せは送信前に `ValidationError`
として弾きます。

## 公開境界

`src/index.ts` から export しているものはすべて public。詳細は同ファイルの export 文を参照。

エントリポイントから export していないモジュール（`http.ts` など）は内部実装で、
直接 import するのは「準 public」扱い（メジャーバージョン以外で変更しない努力はする）。

## 新しいエンドポイントを追加する

1. `types.ts` の `DetectionEndpoint` 型に値を追加し、対応する検出パラメータ型を定義
2. リクエストボディの検証ルール（必須パラメータの組合せ）が既存パターンで賄えるか確認
3. `client.ts` の `Client` に検出メソッド（`client.<name>.detect()`）を追加
4. `types` の検証テストと `client` の `detect()` テストを追加

## HTTP レスポンス形式が変わった場合

`http.ts` のレスポンスパース / エラーマッピング箇所のみ更新。他のファイルは触らない。

## 新しいエラーコードを追加する場合

1. `errors.ts` に新例外クラスを追加（基底 `SateaisError`、HTTP 由来は `SateaisApiError` を継承）
2. `http.ts` の HTTP ステータス → 例外マッピングに追加
3. `index.ts` の export に追加
4. HTTP テストのパラメータに追加

## 例外階層

```
SateaisError                         （基底）
├── SateaisApiError                  （HTTP エラー: status / code / message）
│   ├── AuthenticationError          （401 / 403、API キー未解決）
│   ├── ValidationError              （400）
│   ├── InsufficientCreditsError     （402）
│   ├── NotFoundError                （404 / 410）
│   └── RateLimitError               （429）
├── JobFailedError                   （wait() 中に failed: errorCode / errorMessage）
└── JobTimeoutError                  （wait() タイムアウト）
```

## テスト構成

実 API へはアクセスせず、`fetch` モック中心のユニットテスト（Vitest）。

```
tests/
├── http.test.ts        # HttpApiClient（fetch モック: ヘッダ / リトライ / タイムアウト /
│                        #   NaN パース / エラーマッピング）
├── client.test.ts      # Client / 検出メソッド / Jobs（ApiClient Fake 注入、fake timers）
└── types.test.ts       # 検出パラメータの検証（任意で tsd / expectTypeOf の型テスト）
```

対応関係:

| 変更対象 | テストファイル |
| --- | --- |
| HTTP 通信 / エラーマッピング | `tests/http.test.ts` |
| Client / 検出 / Jobs | `tests/client.test.ts` |
| 検出パラメータの検証 / 型 | `tests/types.test.ts` |

## API リファレンス（TSDoc → TypeDoc）

全 public API には Google Style の日本語 TSDoc を付与します（実装は core Issue 側）。
これを基に `TypeDoc` で API リファレンスを生成する方針です（型定義同梱のため、
`sateais-py` のような外部ドキュメントサイト専用構成ではなく TypeDoc 出力を採用）。
生成・公開は本ドキュメント整備 Issue の範囲で担保します。
