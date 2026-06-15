# Changelog

このプロジェクトの主要な変更は本ファイルに記録します。
形式は [Keep a Changelog](https://keepachangelog.com/) に準じ、バージョニングは
[Semantic Versioning](https://semver.org/) に従います。

## [Unreleased]

### Added

- CI/CD（GitHub Actions）: feature PR で型 / Lint / Format / ビルド / テスト / pack 同梱検証（Node 18・20 マトリクス）
- `develop` マージ時に使い捨て Verdaccio へ publish → install → ESM/CJS/型解決スモークでパッケージング不整合を検出
- `main` マージ時に npm へ正式公開（再公開ガード・`v<version>` タグ自動付与）
- Lint / Format に Biome を導入

### Changed

- **破壊的変更**: 検出メソッドのアクセス形を Python SDK 準拠の facade 形に統一（`client.ship.analyze(...)` → `client.analyze.ship(...)`。oilslick / newbuilding / disappearbuilding / timeseries も同様）。未公開のため移行ガイドは無し
- 公開クラス `SceneAnalysisResource` / `PolygonPeriodAnalysisResource` を `AnalyzeResource` に統合

### Removed

- **破壊的変更**: リトライ機構を削除（`ClientOptions` の `maxRetries` / `retryInitialDelayMs` / `retryMaxDelayMs`、および指数バックオフ）。`sateais-py` に挙動を揃える。タイムアウト（`timeoutMs`）は維持

## [0.1.0] - 2026-06-04

### Added

- 初回リリース
- SDK: `Client` ファサードと検出メソッド5種（ship / oilslick / newbuilding / disappearbuilding / timeseries）
- SDK: ジョブ管理 (`jobs.status` / `jobs.result` / `jobs.wait`)
- 環境変数 `SATEAIS_API_KEY` 対応（`apiKey` 引数 > 環境変数 の優先解決）
- ESM + CommonJS デュアル出力、型定義（`.d.ts`）同梱、ランタイム依存ゼロ（標準 `fetch`）
- 指数バックオフ・リトライ（`429` / `5xx` / `504`）、タイムアウト（`AbortController`）、`NaN` 安全パース
- 例外階層: `SateaisError` → `SateaisApiError` 系（`AuthenticationError` / `ValidationError` / `InsufficientCreditsError` / `NotFoundError` / `RateLimitError`）/ `JobFailedError` / `JobTimeoutError`
