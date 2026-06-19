/**
 * HTTP 通信の抽象境界（Port）と具体実装
 *
 * `ApiClient` interface を唯一の I/O 抽象境界とし、`HttpApiClient` が標準 `fetch`
 * を用いた具体実装を提供する。Bearer 認証・タイムアウト（AbortController）・
 * NaN を含むレスポンスの安全パース・エラー envelope の例外へのマッピングを
 * ここに閉じ込める。
 */

import {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  SateaisApiError,
  SateaisError,
  ValidationError,
} from "./errors";
import type {
  AnalysisEndpoint,
  ApiErrorEnvelope,
  GeoJSONResponse,
  JobCreateResponse,
  JobStatusResponse,
} from "./types";
import { VERSION } from "./version";

/**
 * HTTP 通信の抽象境界（Port）
 *
 * テストでは本 interface の Fake 実装を {@link Client} に注入することで、
 * HTTP 通信を完全に排除して検証できる。
 */
export interface ApiClient {
  /** 検出ジョブを投入する（`POST /analyze/{endpoint}`）。 */
  submitAnalysis(
    endpoint: AnalysisEndpoint,
    params: Record<string, unknown>,
  ): Promise<JobCreateResponse>;
  /** ジョブの状態を取得する（`GET /jobs/{job_id}`）。 */
  getJob(jobId: string): Promise<JobStatusResponse>;
  /** ジョブの結果を GeoJSON で取得する（`GET /jobs/{job_id}/result.geojson`）。 */
  getJobResult(jobId: string): Promise<GeoJSONResponse>;
}

/** {@link HttpApiClient} の設定 */
export interface HttpApiClientConfig {
  /** API キー（`sk_live_xxxxx`）。 */
  apiKey: string;
  /** API ベース URL（末尾スラッシュ無し）。 */
  baseUrl: string;
  /** 1 リクエストあたりのタイムアウト（ミリ秒）。 */
  timeoutMs: number;
  /** 差し替え可能な fetch 実装。 */
  fetch: typeof fetch;
}

/**
 * レスポンステキストの NaN 値を null に置換してから JSON パースする
 *
 * Python 側で `float('nan')` がそのままシリアライズされるケースへの対処。
 * `"key": NaN` を `"key": null` に置換する。
 *
 * @param text パース対象のレスポンステキスト
 * @returns パース結果
 */
export const parseJsonSafe = <T>(text: string): T => {
  const sanitized = text.replace(/:\s*NaN\b/g, ": null");
  return JSON.parse(sanitized) as T;
};

/**
 * HTTP ステータス + エラーコード/メッセージを対応する例外に変換する
 *
 * @param status HTTP ステータスコード
 * @param code 機械可読なエラーコード
 * @param message 人間可読なエラーメッセージ
 * @returns ステータスに対応する {@link SateaisApiError} 系の例外
 */
const mapApiError = (
  status: number,
  code: string,
  message: string,
): SateaisApiError => {
  const options = { code, message, status };
  if (status === 400) return new ValidationError(options);
  if (status === 401 || status === 403) return new AuthenticationError(options);
  if (status === 402) return new InsufficientCreditsError(options);
  if (status === 404 || status === 410) return new NotFoundError(options);
  if (status === 429) return new RateLimitError(options);
  return new SateaisApiError(options);
};

/** 標準 `fetch` を用いた {@link ApiClient} の具体実装 */
export class HttpApiClient implements ApiClient {
  private readonly config: HttpApiClientConfig;

  constructor(config: HttpApiClientConfig) {
    this.config = config;
  }

  submitAnalysis(
    endpoint: AnalysisEndpoint,
    params: Record<string, unknown>,
  ): Promise<JobCreateResponse> {
    return this.request<JobCreateResponse>(
      "POST",
      `/analyze/${endpoint}`,
      params,
    );
  }

  getJob(jobId: string): Promise<JobStatusResponse> {
    return this.request<JobStatusResponse>(
      "GET",
      `/jobs/${encodeURIComponent(jobId)}`,
    );
  }

  getJobResult(jobId: string): Promise<GeoJSONResponse> {
    return this.request<GeoJSONResponse>(
      "GET",
      `/jobs/${encodeURIComponent(jobId)}/result.geojson`,
    );
  }

  /** 認証・共通ヘッダーを生成する */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": `sateais-js/${VERSION}`,
    };
  }

  /**
   * リクエストを送信し、JSON レスポンスをパースして返す
   *
   * 非 OK レスポンスはエラー envelope を解釈して {@link SateaisApiError} 系に変換する。
   * ネットワークエラー・タイムアウトは {@link SateaisError} に変換する（リトライしない）。
   *
   * @param method HTTP メソッド
   * @param path ベース URL からの相対パス（先頭スラッシュ付き）
   * @param body リクエストボディ（GET では省略）
   * @returns パース済みレスポンス
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await this.config.fetch(url, {
        method,
        headers: this.authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) {
        const text = await response.text();
        try {
          return parseJsonSafe<T>(text);
        } catch (parseError) {
          // 成功レスポンスのボディが非 JSON の場合、生の SyntaxError を
          // ネットワークエラー扱いにせず SateaisApiError として送出する
          const detail =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          throw new SateaisApiError({
            code: `HTTP_${response.status}`,
            message: `Invalid JSON in response body: ${detail}`,
            status: response.status,
          });
        }
      }

      throw await this.toApiError(response);
    } catch (error) {
      // API エラーはそのまま送出
      if (error instanceof SateaisApiError) throw error;
      // ネットワークエラー・タイムアウトを変換
      throw this.toNetworkError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 非 OK レスポンスを {@link SateaisApiError} 系に変換する */
  private async toApiError(response: Response): Promise<SateaisApiError> {
    const text = await response.text().catch(() => "");
    let code = `HTTP_${response.status}`;
    let message = text || response.statusText || "Unknown API error";

    try {
      const envelope = parseJsonSafe<Partial<ApiErrorEnvelope>>(text);
      if (envelope.error?.code) code = envelope.error.code;
      if (envelope.error?.message) message = envelope.error.message;
    } catch {
      // JSON でない場合は生テキストをメッセージとして扱う
    }

    return mapApiError(response.status, code, message);
  }

  /** ネットワーク・タイムアウトエラーを {@link SateaisError} に変換する */
  private toNetworkError(error: unknown): SateaisError {
    if (error instanceof SateaisError) return error;
    if (error instanceof DOMException && error.name === "AbortError") {
      return new SateaisError(
        `The request timed out after ${this.config.timeoutMs}ms`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return new SateaisError(`Request failed: ${message}`);
  }
}
