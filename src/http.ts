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
  ResponseParseError,
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

/** JSON で出現しうる非有限リテラル（長い順に並べ、最長一致を優先する）。 */
const NON_FINITE_LITERALS = ["-Infinity", "Infinity", "NaN"] as const;

/** 識別子の継続文字（非有限リテラルの語境界判定に使う）。 */
const isIdentifierChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/**
 * JSON テキスト中の非有限リテラル（`NaN` / `Infinity` / `-Infinity`）を `null` に置換する
 *
 * 文字列リテラルの内側は走査をスキップするため、`{"note":"result: NaN"}` のような
 * 正当な文字列値は破壊しない（旧実装の全文 `replace` によるデータ破損を回避）。
 * オブジェクトのプロパティ値だけでなく、配列要素（`[NaN, 1.0]`）も対象にする。
 *
 * @param text サニタイズ対象の JSON テキスト
 * @returns 非有限リテラルを `null` に置換したテキスト
 */
const sanitizeNonFinite = (text: string): string => {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      // バックスラッシュエスケープは次の 1 文字をそのまま透過する
      if (ch === "\\") {
        i += 1;
        if (i < text.length) result += text[i];
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }

    // 文字列外でのみ非有限リテラルを検出して null に置換する
    let replaced = false;
    for (const literal of NON_FINITE_LITERALS) {
      if (
        text.startsWith(literal, i) &&
        !isIdentifierChar(text[i + literal.length])
      ) {
        result += "null";
        i += literal.length;
        replaced = true;
        break;
      }
    }
    if (replaced) continue;

    result += ch;
    i += 1;
  }

  return result;
};

/**
 * 非有限リテラルを安全に処理してから JSON パースする
 *
 * Python 側で `float('nan')` / `float('inf')` がそのままシリアライズされ、標準では
 * パースできない `NaN` / `Infinity` / `-Infinity` が混入するケースへの対処。
 * これらを `null` に置換してからパースする（{@link sanitizeNonFinite} を参照）。
 *
 * @param text パース対象のレスポンステキスト
 * @returns パース結果
 */
export const parseJsonSafe = <T>(text: string): T => {
  return JSON.parse(sanitizeNonFinite(text)) as T;
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

  /**
   * 認証・共通ヘッダーを生成する
   *
   * `Content-Type: application/json` はボディを送るリクエスト（POST）にのみ付与する。
   * ボディの無い GET に付けると厳格な WAF / プロキシが弾くことがあるため。
   * （`User-Agent` はブラウザの禁止ヘッダで fetch に無視されるが、Node では有効。）
   *
   * @param hasBody リクエストボディを送るか
   */
  private authHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "User-Agent": `sateais-js/${VERSION}`,
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return headers;
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
    const hasBody = body !== undefined;
    const controller = new AbortController();
    // timeoutMs が正の有限値のときだけタイマーを張る。
    // 0 / 負値 / 非有限値はタイムアウト無効化として扱う（旧実装では 0 が
    // 即時 abort になり全リクエストが即タイムアウトしていた）。
    const timeoutMs = this.config.timeoutMs;
    const timeoutId =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

    try {
      const response = await this.config.fetch(url, {
        method,
        headers: this.authHeaders(hasBody),
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.ok) {
        const text = await response.text();
        // 204 / 205 や空ボディの 2xx は「正常な空応答」として扱う
        if (
          response.status === 204 ||
          response.status === 205 ||
          text.trim() === ""
        ) {
          return undefined as T;
        }
        try {
          return parseJsonSafe<T>(text);
        } catch (parseError) {
          // 成功レスポンスのボディが非 JSON の場合、生の SyntaxError を
          // ネットワークエラー扱いにせず ResponseParseError として送出する
          // （API のアプリケーションエラーではなく transport / パース層の問題）
          const detail =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          throw new ResponseParseError({
            status: response.status,
            message: `Invalid JSON in response body: ${detail}`,
          });
        }
      }

      throw await this.toApiError(response);
    } catch (error) {
      // SDK の例外（API エラー・パースエラー等）はそのまま送出
      if (error instanceof SateaisError) throw error;
      // ネットワークエラー・タイムアウトを変換
      throw this.toNetworkError(error);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /** 非 OK レスポンスを {@link SateaisApiError} 系に変換する */
  private async toApiError(response: Response): Promise<SateaisApiError> {
    const text = await response.text().catch(() => "");
    let code = `HTTP_${response.status}`;
    let message = text || response.statusText || "Unknown API error";

    try {
      const envelope = parseJsonSafe<Partial<ApiErrorEnvelope>>(text);
      // API が数値コード等を返しても型契約（code: string）を守るため String 正規化する
      if (envelope.error?.code != null) code = String(envelope.error.code);
      if (envelope.error?.message != null)
        message = String(envelope.error.message);
    } catch {
      // JSON でない場合は生テキストをメッセージとして扱う
    }

    return mapApiError(response.status, code, message);
  }

  /** ネットワーク・タイムアウトエラーを {@link SateaisError} に変換する */
  private toNetworkError(error: unknown): SateaisError {
    if (error instanceof SateaisError) return error;
    // abort 拒否は DOMException とは限らない（undici / polyfill 構成では
    // 通常の Error のことがある）。name === "AbortError" で堅牢に判定する。
    if (error instanceof Error && error.name === "AbortError") {
      return new SateaisError(
        `The request timed out after ${this.config.timeoutMs}ms`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return new SateaisError(`Request failed: ${message}`);
  }
}
