# Changelog

このプロジェクトの主要な変更は本ファイルに記録します。
形式は [Keep a Changelog](https://keepachangelog.com/) に準じ、バージョニングは
[Semantic Versioning](https://semver.org/) に従います。

## [Unreleased]

### Added

- `ResponseParseError`（`SateaisError` 直下）を追加。2xx 応答のボディが JSON でない場合に送出する。従来の `code: "HTTP_<status>"` の `SateaisApiError`（API 同期エラー扱い）を、transport / パース層の問題として分離した

### Fixed

- **`parseJsonSafe` が文字列値を破壊する問題を修正（#1）。** 旧実装の全文 `replace(/:\s*NaN\b/g, ": null")` は文字列リテラル内の `: NaN` も書き換え、`{"note":"result: NaN"}` のような正当な値を破損させていた。文字列リテラルの外側のみを対象にするスキャナに置き換えた
- **非有限値の救済範囲を拡大（#2）。** 配列要素（`[NaN, ...]`）および `Infinity` / `-Infinity` を `null` 置換するようにした（旧実装はオブジェクトのプロパティ値の `NaN` のみ対象）
- **`timeoutMs: 0` / 負値が即時 abort になる問題を修正（#3）。** 正の有限値のときだけタイムアウトを張り、`0` / 負値 / 非有限値は無効化として扱う
- **`jobs.wait` が終端外ステータスで回り続ける問題を修正（#4）。** `pending` / `processing` 以外（`cancelled` / `expired` や未知ステータス）は終端とみなし `JobFailedError` を送出してポーリングを止める。既定 `timeoutMs` 無制限でのハングを防ぐ
- **`JobFailedError.errorMessage` が `undefined` になりうる問題を修正（#5）。** `?? null` を付け型定義（`string | null`）と揃えた
- **`jobs.wait` のタイムアウト境界を修正（#6）。** スリープ前の先読み判定（`elapsed + intervalMs >= timeoutMs`）をやめ、デッドラインを超えない範囲でスリープするようにした。`timeoutMs == intervalMs` でも境界で完了するジョブを拾える
- **タイムアウト判定を `error.name === "AbortError"` ベースに変更（#7）。** `instanceof DOMException` 依存をやめ、abort 拒否が `DOMException` でないランタイム（一部の undici / polyfill 構成）でも「timed out」と分類されるようにした
- **2xx + 空 / 不正ボディの扱いを修正（#8）。** `204` / `205` / 空ボディは正常な空応答として `undefined` を返す。非 JSON は誤解を招く `HTTP_200` ではなく `ResponseParseError` で送出する
- **エラー envelope の `code` を `String` 正規化（#9）。** API が数値コードを返しても `SateaisApiError.code` の型契約（`string`）を破らないようにした（`message` も同様に正規化）
- **ボディの無い GET に `Content-Type` を付けないようにした（#10）。** `Content-Type: application/json` はボディを送る POST にのみ付与する（厳格な WAF / プロキシが GET を弾く可能性への対処）

## [0.1.0-rc.1] - 2026-06-17

### Added

- HTTP リクエストに `User-Agent: sateais-js/<version>` ヘッダを付与（`sateais-py` と命名を揃える）

### Fixed

- 成功レスポンス（2xx）のボディが非 JSON だった場合に、生の `SyntaxError` がネットワークエラー扱いで送出されていた問題を修正。SDK のエラー型（`SateaisApiError`）に包んで `status` と「Invalid JSON in response body」メッセージを返すようにした
- README の相対リンク（`./docs/...` / `./CHANGELOG.md` / `./LICENSE` 等）を絶対 GitHub URL 化し、npm パッケージページでリンク切れになる問題を修正
- `package.json` に `repository` / `homepage` / `bugs` を追加（npm のリンク書き換え・リポジトリ表示が有効化される）

### Documentation

- README / JSDoc に検出エンドポイントの面積上限（newbuilding / disappearbuilding は最大 30000km²、timeseries は最大 50km²）と timeseries の日付範囲上限（3 年以内）を明記（api-orchestrator の契約値に準拠）

## [0.1.0-rc.0] - 2026-06-17

0.1.0 の初回リリース候補（プレリリース）。npm dist-tag は `rc`（`npm i @sateais/sdk@rc`）。`latest` には載らない。

### Added

- SDK: `Client` ファサードと検出メソッド5種（ship / oilslick / newbuilding / disappearbuilding / timeseries）。アクセス形は Python SDK 準拠の facade 形 `client.analyze.<name>(...)`
- SDK: ジョブ管理（`jobs.status` / `jobs.result` / `jobs.wait`）
- 環境変数 `SATEAIS_API_KEY` 対応（`apiKey` 引数 > 環境変数 の優先解決）
- タイムアウト（`AbortController`）、`NaN` 安全パース
- ESM + CommonJS デュアル出力、型定義（`.d.ts`）同梱、ランタイム依存ゼロ（標準 `fetch`）
- 例外階層: `SateaisError` → `SateaisApiError` 系（`AuthenticationError` / `ValidationError` / `InsufficientCreditsError` / `NotFoundError` / `RateLimitError`）/ `JobFailedError` / `JobTimeoutError`
- CI/CD（GitHub Actions）: feature PR で型 / Lint / Format / ビルド / テスト / pack 同梱検証（Node 18・20・24 マトリクス）
- `develop` マージ時に使い捨て Verdaccio へ publish → install → ESM/CJS/型解決スモークでパッケージング不整合を検出
- `main` マージ時に npm へ正式公開（再公開ガード・`v<version>` タグ自動付与）
- Lint / Format に Biome を導入
