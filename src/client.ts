/**
 * SateAIs API クライアント（ユーザー向けファサード）
 *
 * 検出（`client.ship` など）とジョブ操作（`client.jobs`）を同居させた
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
 * scene_id / polygon+date パターンの検出リソース（ship / oilslick）
 */
export class SceneAnalysisResource {
  constructor(
    private readonly api: ApiClient,
    private readonly endpoint: Extract<AnalysisEndpoint, "ship" | "oilslick">,
  ) {}

  /**
   * 検出ジョブを投入する
   *
   * @param params scene_id 指定（フルシーン）または polygon + date 指定（自動選択）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  analyze(params: SceneAnalyzeParams): Promise<JobCreateResponse> {
    const hasScene = "scene_id" in params && !!params.scene_id;
    const hasPolygonDate =
      "polygon" in params && !!params.polygon && !!params.date;
    if (!hasScene && !hasPolygonDate) {
      throw new ValidationError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `${this.endpoint}.analyze requires either 'scene_id' or both 'polygon' and 'date'`,
      });
    }
    return this.api.submitAnalysis(this.endpoint, {
      ...params,
      satellite_id: params.satellite_id ?? DEFAULT_SATELLITE_ID,
    });
  }
}

/**
 * polygon + 期間パターンの検出リソース（newbuilding / disappearbuilding / timeseries）
 */
export class PolygonPeriodAnalysisResource {
  constructor(
    private readonly api: ApiClient,
    private readonly endpoint: Extract<
      AnalysisEndpoint,
      "newbuilding" | "disappearbuilding" | "timeseries"
    >,
  ) {}

  /**
   * 検出ジョブを投入する
   *
   * @param params polygon（WKT）と比較期間（`date_start` / `date_end`）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  analyze(params: PolygonPeriodParams): Promise<JobCreateResponse> {
    if (!params.polygon || !params.date_start || !params.date_end) {
      throw new ValidationError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `${this.endpoint}.analyze requires 'polygon', 'date_start', and 'date_end'`,
      });
    }
    return this.api.submitAnalysis(this.endpoint, {
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
          errorMessage: job.error_message,
        });
      }

      if (
        timeoutMs !== Number.POSITIVE_INFINITY &&
        Date.now() - start + intervalMs >= timeoutMs
      ) {
        throw new JobTimeoutError({ jobId, timeoutMs });
      }

      await sleep(intervalMs);
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
   * リトライ最大回数（初回を除く再試行回数）。既定 4（= 合計最大 5 回）。
   * `429` / `5xx` / `504`・ネットワークエラー・タイムアウトが対象。
   */
  maxRetries?: number;
  /** バックオフ開始待機時間（ミリ秒）。既定 1,000ms。 */
  retryInitialDelayMs?: number;
  /** バックオフ上限待機時間（ミリ秒）。既定 30,000ms。 */
  retryMaxDelayMs?: number;
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
 * const job = await client.ship.analyze({ scene_id: "S1A_IW_GRDH_..." });
 * const geojson = await client.jobs.wait(job.job_id);
 * console.log(geojson.features.length, "ships found");
 * ```
 */
export class Client {
  /** 船舶検出リソース。 */
  readonly ship: SceneAnalysisResource;
  /** オイルスリック検出リソース。 */
  readonly oilslick: SceneAnalysisResource;
  /** 新規建物検出リソース。 */
  readonly newbuilding: PolygonPeriodAnalysisResource;
  /** 消失建物検出リソース。 */
  readonly disappearbuilding: PolygonPeriodAnalysisResource;
  /** 時系列変化検出リソース。 */
  readonly timeseries: PolygonPeriodAnalysisResource;
  /** ジョブ操作リソース（状態取得・結果取得・完了待ち）。 */
  readonly jobs: JobsResource;

  constructor(options: ClientOptions = {}) {
    const api = options.apiClient ?? Client.createHttpApiClient(options);

    this.ship = new SceneAnalysisResource(api, "ship");
    this.oilslick = new SceneAnalysisResource(api, "oilslick");
    this.newbuilding = new PolygonPeriodAnalysisResource(api, "newbuilding");
    this.disappearbuilding = new PolygonPeriodAnalysisResource(
      api,
      "disappearbuilding",
    );
    this.timeseries = new PolygonPeriodAnalysisResource(api, "timeseries");
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
      maxRetries: options.maxRetries ?? 4,
      retryInitialDelayMs: options.retryInitialDelayMs ?? 1_000,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 30_000,
      // bind しないと fetch が Illegal invocation になる環境がある
      fetch: (...args) => fetchImpl(...args),
    });
  }
}
