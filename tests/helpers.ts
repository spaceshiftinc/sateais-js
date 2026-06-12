/**
 * テスト共通ヘルパー
 *
 * 複数のテストファイルで重複していた Fake / モックをここに集約する。
 * `vitest.config.ts` の include は `*.test.ts` のみのため、本ファイルは
 * テストとしては実行されず、import 専用のユーティリティとして扱われる。
 */

import { vi } from "vitest";
import type { ApiClient } from "../src/http";

/**
 * HTTP を完全排除した {@link ApiClient} の Fake 実装
 *
 * 各メソッドは `vi.fn()` なので、戻り値のスタブ（`mockResolvedValue` など）や
 * 呼び出し検証（`toHaveBeenCalledWith` / `not.toHaveBeenCalled`）に利用できる。
 */
export class FakeApiClient implements ApiClient {
  submitAnalysis = vi.fn<ApiClient["submitAnalysis"]>();
  getJob = vi.fn<ApiClient["getJob"]>();
  getJobResult = vi.fn<ApiClient["getJobResult"]>();
}

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
