# Changelog

このプロジェクトの主要な変更は本ファイルに記録します。
形式は [Keep a Changelog](https://keepachangelog.com/) に準じ、バージョニングは
[Semantic Versioning](https://semver.org/) に従います。

## [Unreleased]

## [0.1.0] - 2026-06-04

### Added

- 初回リリース
- SDK: `Client` ファサードと検出メソッド5種（ship / oilslick / newbuilding / disappearbuilding / timeseries）
- SDK: ジョブ管理 (`jobs.status` / `jobs.result` / `jobs.wait`)
- 環境変数 `SATEAIS_API_KEY` 対応（`apiKey` 引数 > 環境変数 の優先解決）
- ESM + CommonJS デュアル出力、型定義（`.d.ts`）同梱、ランタイム依存ゼロ（標準 `fetch`）
- 指数バックオフ・リトライ（`429` / `5xx` / `504`）、タイムアウト（`AbortController`）、`NaN` 安全パース
- 例外階層: `SateaisError` → `SateaisApiError` 系（`AuthenticationError` / `ValidationError` / `InsufficientCreditsError` / `NotFoundError` / `RateLimitError`）/ `JobFailedError` / `JobTimeoutError`
