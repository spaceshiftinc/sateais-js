# CLAUDE.md

このファイルは Claude Code（AI）が `sateais-js` リポジトリで作業する際のガイドラインです。

## プロジェクト概要

**`@sateais/sdk`** — SateAIs（SAR 衛星画像解析プラットフォーム、現状の対応衛星は Sentinel-1）の公式 JavaScript / TypeScript SDK。

- `npm install @sateais/sdk`（ローカル install 含む）1 つで **SDK** を提供する
- CLI は MVP スコープ外（姉妹リポ [`sateais-py`](https://github.com/spaceshiftinc/sateais-py/tree/v0.1.0) は SDK + CLI 同梱だが、本リポは SDK のみ）
- API 仕様: [API リファレンス](https://docs.spcsft.com/)（バックエンドの API オーケストレーターが提供。詳細仕様は社内ドキュメントを参照）
- 公開予定パッケージ — 後方互換性に注意

## 技術スタック

- TypeScript（strict）
- ランタイム依存: **ゼロ**（標準 `fetch` を利用、Node.js 18+ / モダンブラウザ）
- ビルド: `tsup`（ESM + CommonJS デュアル出力、`.d.ts` 型定義同梱）
- テスト: `Vitest`（`fetch` モック、実 API へはアクセスしない）
- Lint / Format: Biome
- パッケージマネージャ: `npm`

## アーキテクチャ

**軽量な層構成**（HTTP のみ Port 抽象化）。詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

```
src/
├── index.ts       # public API の再エクスポート（エントリポイント）
├── types.ts       # エンティティ + 検出リクエスト/レスポンス型
├── errors.ts      # 例外階層
├── http.ts        # ApiClient interface + HttpApiClient（唯一の I/O 抽象境界）
├── client.ts      # Client + Analysis（検出）+ Jobs（ユーザー向けファサード）
```

### 依存方向（厳守）

- `types.ts` / `errors.ts`: 外部依存なし（標準のみ）
- `http.ts`: `fetch`・通信・リトライ・エラーマッピングをここに閉じ込める
- `client.ts` / `index.ts`: 上のすべてを結線する composition root

### 設計判断: なぜ Port は ApiClient だけか

- **`ApiClient` interface あり**: テストで HTTP を完全排除した Fake で網羅でき、将来別 transport を足す余地もある（`fetch` モックでテストする方針と整合）
- **タイマー（`setTimeout`）は Port なし**: テストは Vitest の fake timers で十分。interface を切るとファイル数が増えるだけで価値が無い

**「Port を切るか」の判断基準は「テストで本当に困るか」+「差し替える未来が現実的にあるか」**。両方弱ければ Port を切らない。

## コーディング規約

ワークスペース共通の規約に従う:

- **docstring（TSDoc）/ コメントは日本語**
- **ログメッセージは英語**（`[モジュール名] message: detail` 形式）
- TypeScript strict、型を明示（`any` 禁止）
- TODO / FIXME / デバッグコード残し禁止
- 仕様変更時は `docs/` を先に更新

### Public API の境界

`src/index.ts` から export しているものはすべて public。SemVer 注意:

```ts
export {
  Client,
  // 型
  type AnalysisEndpoint,
  type JobCreateResponse,
  type JobStatusResponse,
  type GeoJSONResponse,
  // 例外
  SateaisError,
  SateaisApiError,
  AuthenticationError,
  ValidationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  JobFailedError,
  JobTimeoutError,
} from "...";
```

エントリポイントから export していないものは内部実装。直接 import は「準 public」扱い（メジャーバージョン以外で変更しない努力はする）。

## よくある作業の指針

### 新エンドポイントを追加する

1. `types.ts` の `AnalysisEndpoint` 型に値を追加し、対応する検出パラメータ型を定義
2. リクエストボディの検証ルール（必須パラメータの組合せ）を追加
3. `client.ts` の `AnalyzeResource` に検出メソッド（`client.analyze.<name>()`）を追加
4. テスト追加（`types` の検証 + `client.analyze.<name>()`）

### HTTP レスポンス形式が変わった

`http.ts` のレスポンスパース / エラーマッピング箇所のみ更新。他のファイルには触らない。

### 新しいエラーコードを追加する

1. `errors.ts` に例外クラスを追加（基底は `SateaisError`、HTTP 由来は `SateaisApiError` を継承）
2. `http.ts` の HTTP ステータス → 例外マッピングに追加
3. `index.ts` の export に追加
4. テストのパラメータに追加

### 新しい外部ライブラリを導入したい

原則 **ランタイム依存ゼロ** を維持する。やむを得ない場合:

1. `http.ts` 相当の I/O 専用モジュールに依存を閉じ込める
2. `types.ts` / `errors.ts` には絶対に持ち込まない
3. `package.json` の `dependencies` に追加（`devDependencies` と取り違えない）

## テスト

実 API には接続せず、`fetch` をモックしてユニットテスト中心に検証する（Vitest）。

```bash
npm test                 # 全テスト
npm run test:coverage    # カバレッジ計測（v8、目安 statements 80%）
```

主要パターン:

- **HTTP を絡めるテスト** → グローバル `fetch` を `vi.fn()` で差し替え（または MSW）
- **HTTP を絡めないテスト** → `ApiClient` の Fake 実装を注入
- **時刻系（`wait` のポーリング）** → Vitest の fake timers で制御

詳細なテスト方針は [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) を参照。

## ビルド / パッケージング

- `tsup` で ESM（`.mjs`）+ CommonJS（`.cjs`）+ `.d.ts` を `dist/` に出力
- `package.json` の `exports` / `main` / `module` / `types` を正しく設定
- `files` を `dist` 中心に絞り、公開物を最小化
- `prepublishOnly` でビルドを強制
- パッケージング不整合（`exports` 誤り・`dist`/`.d.ts` 同梱漏れ・ESM/CJS 解決失敗）は
  develop マージ時の Verdaccio 検証で機械的に捕捉する

## 後方互換性 (publish 後)

- public シンボルの **削除・改名は禁止**（deprecation 経由のみ）
- メソッド引数の追加はオプション引数（options オブジェクトのフィールド追加）で
- `AnalysisEndpoint` の値（文字列）は API 契約と一致させる
- 例外クラスの継承関係は SemVer メジャー以外で変更しない
- `ApiClient` interface へのメソッド追加（破壊的変更）はメジャー以外禁止

## ブランチ / PR

- `develop`（デフォルト）← `feature/*`
- リリース時のみ `develop` → `main`（main マージ = npm 正式公開）
- 全変更は PR 経由、直接 push 禁止
- PR タイトル: `feat:` / `fix:` / `docs:` / `chore:` / `refactor:`

## 関連リポジトリ
- [sateais-py](https://github.com/spaceshiftinc/sateais-py/tree/v0.1.0) — Python SDK / CLI（姉妹リポ）
