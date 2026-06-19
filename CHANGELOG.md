# Changelog

このプロジェクトの主要な変更は本ファイルに記録します。
形式は [Keep a Changelog](https://keepachangelog.com/) に準じ、バージョニングは
[Semantic Versioning](https://semver.org/) に従います。

## [Unreleased]

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
