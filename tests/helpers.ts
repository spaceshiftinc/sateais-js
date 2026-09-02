/**
 * テスト共通ヘルパー
 *
 * 複数のテストファイルで重複していた Fake / モックをここに集約する。
 * `vitest.config.ts` の include は `*.test.ts` のみのため、本ファイルは
 * テストとしては実行されず、import 専用のユーティリティとして扱われる。
 */

import { vi } from "vitest";
import type { ApiClient } from "../src/http";
import type { PreviewResponse } from "../src/types";

/**
 * HTTP を完全排除した {@link ApiClient} の Fake 実装
 *
 * 各メソッドは `vi.fn()` なので、戻り値のスタブ（`mockResolvedValue` など）や
 * 呼び出し検証（`toHaveBeenCalledWith` / `not.toHaveBeenCalled`）に利用できる。
 */
export class FakeApiClient implements ApiClient {
  submitAnalysis = vi.fn<ApiClient["submitAnalysis"]>();
  // previewAnalysis は interface 上オプショナルのため NonNullable で関数型に絞る
  previewAnalysis = vi.fn<NonNullable<ApiClient["previewAnalysis"]>>();
  getJob = vi.fn<ApiClient["getJob"]>();
  getJobResult = vi.fn<ApiClient["getJobResult"]>();
}

/**
 * テスト用 {@link PreviewResponse} のファクトリ
 *
 * API 契約（`endpoint_id` / `area_sqkm` / `coverage` / `credits` / `warnings`）の
 * 形をここに一元化する。`overrides` で個別ケースの差分だけを上書きする。
 *
 * @param overrides 上書きするフィールド
 * @returns プレビューレスポンス
 */
export const makePreviewResponse = (
  overrides: Partial<PreviewResponse> = {},
): PreviewResponse => ({
  endpoint_id: "newbuilding",
  area_sqkm: 78.4,
  coverage: {
    method: "estimated",
    requested_area_sqkm: 100.2,
    ratio: 0.78,
    polygon: "POLYGON((0 0,1 0,1 1,0 0))",
  },
  credits: { estimated: 1.0, balance: 480.0, sufficient: true },
  warnings: [
    {
      code: "LOW_AOI_COVERAGE",
      message: "Scenes cover only 78% of the requested area.",
    },
  ],
  ...overrides,
});

/**
 * テスト用の最小 `Response` モックを生成する
 *
 * `ok` は `status` から導出する。`fetch` の戻り値として差し替えて利用する。
 *
 * @param status HTTP ステータスコード
 * @param body レスポンスボディ（`text()` で解決される）
 * @param statusText ステータステキスト。既定は空文字。
 * @returns `Response` 互換のモック
 */
export const makeResponse = (
  status: number,
  body: string,
  statusText = "",
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  }) as unknown as Response;
