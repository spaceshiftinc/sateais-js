# Contributing

`@sateais/sdk`（JS/TS SDK）開発者向けガイド。

## 開発環境セットアップ

Node.js 18+ と `npm` を使用します（`package.json` の `engines` でバージョン固定）。

```bash
git clone git@github.com:spaceshiftinc/sateais-js.git
cd sateais-js
npm install
```

ローカルでの動作確認（`npm install @sateais/sdk` 相当をローカル検証）:

```bash
# 方法1) npm link でリンク
npm run build
npm link
cd /path/to/your-app && npm link @sateais/sdk

# 方法2) npm pack で tarball を作って install（公開物に近い検証）
npm run build
npm pack                                  # sateais-sdk-x.y.z.tgz が生成される
cd /path/to/your-app && npm install /path/to/sateais-sdk-x.y.z.tgz
```

## 日常コマンド

```bash
# テスト（Vitest、実 API へは接続しない）
npm test                      # 全テスト
npm run test:coverage         # カバレッジ計測（v8、目安 statements 80%）

# Lint / Format
npm run lint                  # チェック（ESLint もしくは Biome）
npm run format                # フォーマット

# 型チェック
npm run typecheck             # tsc --noEmit

# ビルド（ESM + CJS + .d.ts を dist/ に出力）
npm run build
```

CI ではこれら（型 / Lint / ビルド / テスト / `npm pack`）がすべて通る必要があります。

## ブランチ戦略

- `develop`（デフォルト）← `feature/*`
- リリース時のみ `develop` → `main`（**main マージ = npm 正式公開**）
- 全変更は PR 経由、直接 push 禁止
- PR タイトル: `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` プレフィクス

## コーディング規約

ワークスペース共通の規約に従います:

- **docstring（TSDoc）/ コメントは日本語**
- **ログメッセージは英語**（`[モジュール名] message: detail` 形式）
- TypeScript strict、型を明示（`any` 禁止）
- TODO / FIXME / デバッグコード残し禁止
- 仕様変更時は `docs/` を先に更新

## アーキテクチャを守る

[ARCHITECTURE.md](ARCHITECTURE.md) の依存方向ルールを厳守してください。

| ファイル | 依存できる相手 |
| --- | --- |
| `types.ts` / `errors.ts` | 外部依存なし（標準のみ） |
| `http.ts` | `types`, `errors`（`fetch`・通信はここに閉じる） |
| `client.ts` / `index.ts` | 上のすべて |

レビュー時の主な観点:

1. 新しい外部ライブラリ依存は `http.ts` 相当の I/O モジュールに閉じているか（原則ランタイム依存ゼロを維持）
2. 検出リクエストの必須パラメータ組合せの検証が、各検出メソッドの submit 直前にあるか
3. SDK 固有の引数解釈・出力整形が下位モジュール（`http.ts` / `types.ts`）に漏れていないか
4. 「これは Port を切るべきか？」を即決せず、判断基準（テストで困るか + 差し替え未来があるか）を当てはめる

## テストの追加

新機能・バグ修正には必ずテストを追加してください。実 API へはアクセスせず、
`fetch` をモックします（Vitest）。

| 変更対象 | テストファイル |
| --- | --- |
| HTTP 通信 / エラーマッピング | `tests/http.test.ts` |
| Client / 検出 / Jobs | `tests/client.test.ts` |
| 検出パラメータの検証 / 型 | `tests/types.test.ts` |

- HTTP を絡めるテストは、グローバル `fetch` を `vi.fn()` で差し替える（または MSW）
- HTTP を絡めないテストは、`ApiClient` の Fake 実装を `Client` に注入する
- `jobs.wait` のポーリングは Vitest の fake timers で制御する
- 共通の Fake / モック（`FakeApiClient` / `makeResponse`）は [`tests/helpers.ts`](../tests/helpers.ts)
  に集約してある。テストファイル内で再定義せず import して再利用する

## リリース手順

ブランチ戦略は `develop`（検証）→ `main`（正式公開）です（ci/cd Issue と整合）。

1. `develop` 上で `package.json` の `version` を上げる（`npm version <patch|minor|major>` 等）
2. [CHANGELOG.md](../CHANGELOG.md) に変更点を追記（Keep a Changelog 形式）
3. `develop` にマージ → CI が使い捨て **Verdaccio** で publish → install → ESM/CJS import スモークを実行し、
   パッケージング不整合（`exports` 誤り・`dist`/`.d.ts` 同梱漏れ等）を検出
4. `develop` → `main` の PR をマージ → npm へ正式公開（`npm publish --access public`）。
   `version` が npm 上に未存在のときだけ publish される（再公開ガード）
5. 公開後に `v<version>` タグを付与（自動・任意）

> dev スナップショット版は Verdaccio 上で使い捨てのため保持されません。
