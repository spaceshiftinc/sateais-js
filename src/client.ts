/**
 * SateAIs API クライアント（ユーザー向けファサード）
 *
 * 検出（`client.analyze.ship` など）とジョブ操作（`client.jobs`）を同居させた
 * composition root。{@link ApiClient} を結線して動作する。
 */

import {
  AuthenticationError,
  JobFailedError,
  JobTimeoutError,
  ValidationError,
} from "./errors";
import { HttpApiClient } from "./http";
import type { ApiClient } from "./http";
import type {
  AnalysisEndpoint,
  GeoJSONResponse,
  JobCreateResponse,
  JobStatusResponse,
  PolygonPeriodParams,
  SatelliteId,
  SceneAnalyzeParams,
} from "./types";

/** 既定のベース URL */
const DEFAULT_BASE_URL = "https://api.spcsft.com/api/v1";

/** 既定の衛星種別 */
const DEFAULT_SATELLITE_ID: SatelliteId = "sentinel-1";

/** 環境変数から API キーを解決する（Node.js のみ。ブラウザでは undefined） */
const resolveApiKeyFromEnv = (): string | undefined => {
  // @types/node に依存せずブラウザでも安全に process.env を参照する
  const proc = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return proc?.env?.SATEAIS_API_KEY;
};

/** `jobs.wait` のオプション */
export interface WaitOptions {
  /**
   * ポーリング間隔（ミリ秒）。既定 60,000ms（検出は 30〜60 分かかるため）。
   */
  intervalMs?: number;
  /**
   * 完了待ちの全体タイムアウト（ミリ秒）。既定は無制限（`Infinity`）。
   * 超過すると {@link JobTimeoutError} を送出する。
   */
  timeoutMs?: number;
  /**
   * ポーリングごとに呼ばれるコールバック。進捗表示などに利用する。
   *
   * @param job 取得したジョブステータス
   */
  onPoll?: (job: JobStatusResponse) => void;
}

/** スリープ */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ポーリング継続中（非終端）とみなすステータス
 *
 * これら以外（`completed` / `failed` のほか `cancelled` / `expired` や未知の
 * ステータス）はすべて終端として扱い、無限ポーリングを防ぐ。
 */
const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "processing",
]);

/**
 * 検出リソース（`client.analyze`）
 *
 * 各検出エンドポイントを `client.analyze.ship(...)` のようなメソッドとして提供する。
 * 姉妹リポ `sateais-py` の `client.analyze` facade に形を揃えている。
 */
export class AnalyzeResource {
  constructor(private readonly api: ApiClient) {}

  /**
   * 船舶検出ジョブを投入する（`ship`）
   *
   * @param params scene_id 指定（フルシーン）または polygon + date 指定（自動選択）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  ship(params: SceneAnalyzeParams): Promise<JobCreateResponse> {
    return this.submitScene("ship", params);
  }

  /**
   * オイルスリック検出ジョブを投入する（`oilslick`）
   *
   * @param params scene_id 指定（フルシーン）または polygon + date 指定（自動選択）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  oilslick(params: SceneAnalyzeParams): Promise<JobCreateResponse> {
    return this.submitScene("oilslick", params);
  }

  /**
   * 新規建物検出ジョブを投入する（`newbuilding`）
   *
   * `polygon` の面積上限は 30000km²（超過時は API が `ValidationError` を返す）。
   *
   * @param params polygon（WKT）と比較期間（`date_start` / `date_end`）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  newbuilding(params: PolygonPeriodParams): Promise<JobCreateResponse> {
    return this.submitPolygonPeriod("newbuilding", params);
  }

  /**
   * 消失建物検出ジョブを投入する（`disappearbuilding`）
   *
   * `polygon` の面積上限は 30000km²（超過時は API が `ValidationError` を返す）。
   *
   * @param params polygon（WKT）と比較期間（`date_start` / `date_end`）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  disappearbuilding(params: PolygonPeriodParams): Promise<JobCreateResponse> {
    return this.submitPolygonPeriod("disappearbuilding", params);
  }

  /**
   * 時系列変化検出ジョブを投入する（`timeseries`）
   *
   * `polygon` の面積上限は 50km²、`date_start`〜`date_end` は 3 年以内
   * （いずれも超過時は API が `ValidationError` を返す）。
   *
   * @param params polygon（WKT）と比較期間（`date_start` / `date_end`）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  timeseries(params: PolygonPeriodParams): Promise<JobCreateResponse> {
    return this.submitPolygonPeriod("timeseries", params);
  }

  /** scene_id / polygon+date パターン（ship / oilslick）の検証と投入 */
  private submitScene(
    endpoint: Extract<AnalysisEndpoint, "ship" | "oilslick">,
    params: SceneAnalyzeParams,
  ): Promise<JobCreateResponse> {
    const hasScene = "scene_id" in params && !!params.scene_id;
    const hasPolygonDate =
      "polygon" in params && !!params.polygon && !!params.date;
    if (!hasScene && !hasPolygonDate) {
      throw new ValidationError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `analyze.${endpoint} requires either 'scene_id' or both 'polygon' and 'date'`,
      });
    }
    return this.api.submitAnalysis(endpoint, {
      ...params,
      satellite_id: params.satellite_id ?? DEFAULT_SATELLITE_ID,
    });
  }

  /** polygon + 期間パターン（newbuilding / disappearbuilding / timeseries）の検証と投入 */
  private submitPolygonPeriod(
    endpoint: Extract<
      AnalysisEndpoint,
      "newbuilding" | "disappearbuilding" | "timeseries"
    >,
    params: PolygonPeriodParams,
  ): Promise<JobCreateResponse> {
    if (!params.polygon || !params.date_start || !params.date_end) {
      throw new ValidationError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `analyze.${endpoint} requires 'polygon', 'date_start', and 'date_end'`,
      });
    }
    return this.api.submitAnalysis(endpoint, {
      ...params,
      satellite_id: params.satellite_id ?? DEFAULT_SATELLITE_ID,
    });
  }
}

/** ジョブの状態取得・結果取得・完了待ちを提供するリソース */
export class JobsResource {
  constructor(private readonly api: ApiClient) {}

  /**
   * ジョブの状態を取得する（`GET /jobs/{job_id}`）
   *
   * @param jobId ジョブ UUID
   * @returns ジョブステータス
   */
  status(jobId: string): Promise<JobStatusResponse> {
    return this.api.getJob(jobId);
  }

  /**
   * ジョブの結果を GeoJSON で取得する（`GET /jobs/{job_id}/result.geojson`）
   *
   * ジョブが `completed` になっている必要がある。保持期間（30日）を過ぎると
   * {@link NotFoundError}（`410 GONE`）になる。
   *
   * @param jobId ジョブ UUID
   * @returns GeoJSON FeatureCollection
   */
  result(jobId: string): Promise<GeoJSONResponse> {
    return this.api.getJobResult(jobId);
  }

  /**
   * ジョブが `completed` になるまでポーリングし、結果 GeoJSON を返す
   *
   * `completed` になったら自動で結果を取得して返す。`failed` に遷移した場合は
   * `errorCode` / `errorMessage` を載せた {@link JobFailedError} を送出する。
   * `timeoutMs` を超過した場合は {@link JobTimeoutError} を送出する。
   *
   * @param jobId ジョブ UUID
   * @param options ポーリング間隔・タイムアウト・コールバック
   * @returns 完了したジョブの結果 GeoJSON
   */
  async wait(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<GeoJSONResponse> {
    const intervalMs = options.intervalMs ?? 60_000;
    const timeoutMs = options.timeoutMs ?? Number.POSITIVE_INFINITY;
    const start = Date.now();

    for (;;) {
      const job = await this.api.getJob(jobId);
      options.onPoll?.(job);

      if (job.status === "completed") {
        return this.api.getJobResult(jobId);
      }
      if (job.status === "failed") {
        throw new JobFailedError({
          jobId,
          errorCode: job.error_code ?? job.error ?? null,
          errorMessage: job.error_message ?? null,
        });
      }
      // pending / processing 以外（cancelled / expired / 未知ステータス）も
      // 終端とみなす。これを検知せず回り続けると、既定 timeoutMs が無制限のため
      // 永久にポーリングしてハングする。
      if (!IN_PROGRESS_STATUSES.has(job.status)) {
        throw new JobFailedError({
          jobId,
          errorCode: job.error_code ?? job.error ?? job.status,
          errorMessage:
            job.error_message ??
            `Job ended with unexpected status: ${job.status}`,
        });
      }

      // タイムアウト判定はスリープ前の経過時間で行う。判定後はデッドラインを
      // 超えない範囲でスリープし、境界ぴったりで完了するジョブも次の周回で拾う。
      const elapsed = Date.now() - start;
      if (timeoutMs !== Number.POSITIVE_INFINITY && elapsed >= timeoutMs) {
        throw new JobTimeoutError({ jobId, timeoutMs });
      }
      const waitMs =
        timeoutMs === Number.POSITIVE_INFINITY
          ? intervalMs
          : Math.min(intervalMs, timeoutMs - elapsed);

      await sleep(waitMs);
    }
  }
}

/** `Client` のコンストラクタオプション */
export interface ClientOptions {
  /**
   * API キー（`sk_live_xxxxx`）。省略時は環境変数 `SATEAIS_API_KEY` から解決する
   * （優先度: `apiKey` 引数 > 環境変数）。いずれも未解決なら {@link AuthenticationError}。
   */
  apiKey?: string;
  /**
   * API ベース URL。既定は `https://api.spcsft.com/api/v1`。
   * 末尾のスラッシュは自動的に除去される。
   */
  baseUrl?: string;
  /** 1 リクエストあたりのタイムアウト（ミリ秒）。既定 30,000ms。 */
  timeoutMs?: number;
  /**
   * 差し替え可能な fetch 実装。既定はグローバルの `fetch`（Node.js 18+ / ブラウザ）。
   */
  fetch?: typeof fetch;
  /**
   * テスト用に {@link ApiClient} 実装を直接注入する。指定時は HTTP 関連オプション
   * （`apiKey` / `baseUrl` / `fetch` など）は無視される。
   */
  apiClient?: ApiClient;
}

/**
 * SateAIs REST API クライアント
 *
 * 検出ジョブの投入・状態取得・結果取得を提供する。
 *
 * @example
 * ```ts
 * const client = new Client({ apiKey: "sk_live_xxxxx" });
 * const job = await client.analyze.ship({ scene_id: "S1A_IW_GRDH_..." });
 * const geojson = await client.jobs.wait(job.job_id);
 * console.log(geojson.features.length, "ships found");
 * ```
 */
export class Client {
  /** 検出リソース（`analyze.ship` / `analyze.oilslick` など）。 */
  readonly analyze: AnalyzeResource;
  /** ジョブ操作リソース（状態取得・結果取得・完了待ち）。 */
  readonly jobs: JobsResource;

  constructor(options: ClientOptions = {}) {
    const api = options.apiClient ?? Client.createHttpApiClient(options);

    this.analyze = new AnalyzeResource(api);
    this.jobs = new JobsResource(api);
  }

  /** オプションと環境変数から {@link HttpApiClient} を構築する */
  private static createHttpApiClient(options: ClientOptions): HttpApiClient {
    const apiKey = options.apiKey ?? resolveApiKeyFromEnv();
    if (!apiKey) {
      throw new AuthenticationError({
        code: "UNAUTHORIZED",
        status: 401,
        message:
          "API key is required. Pass options.apiKey or set the SATEAIS_API_KEY environment variable",
      });
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error(
        "Global fetch is not available. Use Node.js 18+ or pass options.fetch",
      );
    }

    return new HttpApiClient({
      apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      timeoutMs: options.timeoutMs ?? 30_000,
      // bind しないと fetch が Illegal invocation になる環境がある
      fetch: (...args) => fetchImpl(...args),
    });
  }
}
