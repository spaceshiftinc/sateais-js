/**
 * SateAIs API クライアント（ユーザー向けファサード）
 *
 * 検出（`client.analyze.ship` など）・投入前プレビュー（`client.preview`）・
 * ジョブ操作（`client.jobs`）を同居させた composition root。
 * {@link ApiClient} を結線して動作する。
 */

import {
  AuthenticationError,
  JobFailedError,
  JobTimeoutError,
  SateaisError,
  ValidationError,
} from "./errors";
import { HttpApiClient } from "./http";
import type { ApiClient } from "./http";
import type {
  AnalysisEndpoint,
  GeoJSONResponse,
  JobCreateResponse,
  JobStatusResponse,
  LulcParams,
  PolygonPeriodParams,
  PreviewResponse,
  SatelliteId,
  SceneAnalyzeParams,
} from "./types";

/** 既定のベース URL */
const DEFAULT_BASE_URL = "https://api.spcsft.com/api/v1";

/** 既定の衛星種別 */
const DEFAULT_SATELLITE_ID: SatelliteId = "sentinel-1";

/** `lulc` の既定の衛星種別（API は polygon + month パターンでこの値を必須とする） */
const LULC_SATELLITE_ID = "sentinel-2";

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
 * scene_id / polygon+date パターン（ship / oilslick）の必須組合せを検証し、
 * 既定の `satellite_id` を補完したリクエストボディを構築する
 *
 * @param label エラーメッセージ用のメソッド表記（`analyze.ship` / `preview.ship` 等）
 * @param params 検証対象のパラメータ
 * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
 */
const buildSceneBody = (
  label: string,
  params: SceneAnalyzeParams,
): Record<string, unknown> => {
  const hasScene = "scene_id" in params && !!params.scene_id;
  const hasPolygonDate =
    "polygon" in params && !!params.polygon && !!params.date;
  if (!hasScene && !hasPolygonDate) {
    throw new ValidationError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `${label} requires either 'scene_id' or both 'polygon' and 'date'`,
    });
  }
  return {
    ...params,
    satellite_id: params.satellite_id ?? DEFAULT_SATELLITE_ID,
  };
};

/**
 * polygon + 期間パターン（newbuilding / disappearbuilding / timeseries）の必須
 * パラメータを検証し、既定の `satellite_id` を補完したリクエストボディを構築する
 *
 * @param label エラーメッセージ用のメソッド表記（`analyze.timeseries` 等）
 * @param params 検証対象のパラメータ
 * @throws {@link ValidationError} 必須パラメータが欠けている場合
 */
const buildPolygonPeriodBody = (
  label: string,
  params: PolygonPeriodParams,
): Record<string, unknown> => {
  if (!params.polygon || !params.date_start || !params.date_end) {
    throw new ValidationError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `${label} requires 'polygon', 'date_start', and 'date_end'`,
    });
  }
  return {
    ...params,
    satellite_id: params.satellite_id ?? DEFAULT_SATELLITE_ID,
  };
};

/**
 * polygon + 基準月パターン（lulc）の必須パラメータを検証し、既定の
 * `satellite_id`（`"sentinel-2"`）を補完したリクエストボディを構築する
 *
 * `month` の値の妥当性（偶数月・下限・終了済み）は API 側で判定する。
 *
 * @param label エラーメッセージ用のメソッド表記（`analyze.lulc` / `preview.lulc`）
 * @param params 検証対象のパラメータ
 * @throws {@link ValidationError} 必須パラメータが欠けている場合
 */
const buildLulcBody = (
  label: string,
  params: LulcParams,
): Record<string, unknown> => {
  if (!params.polygon || !params.month) {
    throw new ValidationError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `${label} requires 'polygon' and 'month'`,
    });
  }
  return {
    ...params,
    satellite_id: params.satellite_id ?? LULC_SATELLITE_ID,
  };
};

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
    return this.api.submitAnalysis(
      "ship",
      buildSceneBody("analyze.ship", params),
    );
  }

  /**
   * オイルスリック検出ジョブを投入する（`oilslick`）
   *
   * @param params scene_id 指定（フルシーン）または polygon + date 指定（自動選択）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータの組合せが不正な場合
   */
  oilslick(params: SceneAnalyzeParams): Promise<JobCreateResponse> {
    return this.api.submitAnalysis(
      "oilslick",
      buildSceneBody("analyze.oilslick", params),
    );
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
    return this.api.submitAnalysis(
      "newbuilding",
      buildPolygonPeriodBody("analyze.newbuilding", params),
    );
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
    return this.api.submitAnalysis(
      "disappearbuilding",
      buildPolygonPeriodBody("analyze.disappearbuilding", params),
    );
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
    return this.api.submitAnalysis(
      "timeseries",
      buildPolygonPeriodBody("analyze.timeseries", params),
    );
  }

  /**
   * 土地利用・土地被覆分類ジョブを投入する（`lulc`）
   *
   * Sentinel-2 + Sentinel-1 の 12 ヶ月分の画像から、`polygon` のバウンディング
   * ボックスを 10m 画素ごとに 15 クラスへ分類する。バウンディングボックスの面積は
   * 0.5〜350km²、`month` は偶数月のみ（いずれも違反時は API が `ValidationError`）。
   *
   * 結果は GeoJSON ではなく zip のため、{@link JobsResource.waitArchive} /
   * {@link JobsResource.resultArchive} で取得する。
   *
   * @param params polygon（WKT）と解析期間の最終月（`month`, `YYYY-MM`）
   * @returns 投入されたジョブの情報（`job_id` を含む）
   * @throws {@link ValidationError} 必須パラメータが欠けている場合
   */
  lulc(params: LulcParams): Promise<JobCreateResponse> {
    return this.api.submitAnalysis(
      "lulc",
      buildLulcBody("analyze.lulc", params),
    );
  }
}

/**
 * 投入前プレビューリソース（`client.preview`）
 *
 * 検出メソッドと同名・同パラメータで、ジョブを投入せずに消費クレジットの
 * 見積もり・残高・AOI カバレッジを取得する。クレジットは消費されない。
 * 姉妹リポ `sateais-py` の `client.preview` facade に形を揃えている。
 *
 * - 残高不足はエラーにならず `credits.sufficient: false` として返る
 * - `scene_id` 指定など面積が確定しない入力ではクレジットが見積もれず、
 *   `credits.estimated` は `null`（`warnings` に `CREDITS_NOT_ESTIMABLE`）になる
 * - プレビューが通ってもジョブ投入時には失敗しうる（同時実行上限 429、
 *   残高不足 402 など。実消費が見積もりを上回ることはない）
 *
 * 各メソッドは対応する検出メソッドと同じ検証を行い、不正な組合せは
 * {@link ValidationError} として送信前に弾く。
 */
export class PreviewResource {
  constructor(private readonly api: ApiClient) {}

  /**
   * 船舶検出（`ship`）の投入前プレビューを取得する
   *
   * @param params 検出メソッド {@link AnalyzeResource.ship} と同じパラメータ
   * @returns 見積もり結果（`credits` / `coverage` / `warnings`）
   */
  ship(params: SceneAnalyzeParams): Promise<PreviewResponse> {
    return this.dispatch("ship", buildSceneBody("preview.ship", params));
  }

  /**
   * オイルスリック検出（`oilslick`）の投入前プレビューを取得する
   *
   * @param params 検出メソッド {@link AnalyzeResource.oilslick} と同じパラメータ
   * @returns 見積もり結果（`credits` / `coverage` / `warnings`）
   */
  oilslick(params: SceneAnalyzeParams): Promise<PreviewResponse> {
    return this.dispatch(
      "oilslick",
      buildSceneBody("preview.oilslick", params),
    );
  }

  /**
   * 新規建物検出（`newbuilding`）の投入前プレビューを取得する
   *
   * @param params 検出メソッド {@link AnalyzeResource.newbuilding} と同じパラメータ
   * @returns 見積もり結果（`credits` / `coverage` / `warnings`）
   */
  newbuilding(params: PolygonPeriodParams): Promise<PreviewResponse> {
    return this.dispatch(
      "newbuilding",
      buildPolygonPeriodBody("preview.newbuilding", params),
    );
  }

  /**
   * 消失建物検出（`disappearbuilding`）の投入前プレビューを取得する
   *
   * @param params 検出メソッド {@link AnalyzeResource.disappearbuilding} と同じパラメータ
   * @returns 見積もり結果（`credits` / `coverage` / `warnings`）
   */
  disappearbuilding(params: PolygonPeriodParams): Promise<PreviewResponse> {
    return this.dispatch(
      "disappearbuilding",
      buildPolygonPeriodBody("preview.disappearbuilding", params),
    );
  }

  /**
   * 時系列変化検出（`timeseries`）の投入前プレビューを取得する
   *
   * @param params 検出メソッド {@link AnalyzeResource.timeseries} と同じパラメータ
   * @returns 見積もり結果（`credits` / `coverage` / `warnings`）
   */
  timeseries(params: PolygonPeriodParams): Promise<PreviewResponse> {
    return this.dispatch(
      "timeseries",
      buildPolygonPeriodBody("preview.timeseries", params),
    );
  }

  /**
   * 土地利用・土地被覆分類（`lulc`）の投入前プレビューを取得する
   *
   * クレジットは `polygon` のバウンディングボックスの面積で見積もられ、
   * `area_sqkm` はその面積になる。`coverage` は常に `null`。
   *
   * @param params 検出メソッド {@link AnalyzeResource.lulc} と同じパラメータ
   * @returns 見積もり結果（`credits` / `warnings`）
   */
  lulc(params: LulcParams): Promise<PreviewResponse> {
    return this.dispatch("lulc", buildLulcBody("preview.lulc", params));
  }

  /**
   * `previewAnalysis` の実装有無を確認して呼び出す
   *
   * `previewAnalysis` は後方互換のため {@link ApiClient} 上でオプショナル。
   * 未実装の実装（旧 Fake 等）が注入された場合は明確なエラーで弾く。
   */
  private dispatch(
    endpoint: AnalysisEndpoint,
    body: Record<string, unknown>,
  ): Promise<PreviewResponse> {
    const previewAnalysis = this.api.previewAnalysis;
    if (previewAnalysis === undefined) {
      throw new SateaisError(
        "The injected ApiClient does not implement previewAnalysis, so client.preview is unavailable",
      );
    }
    return previewAnalysis.call(this.api, endpoint, body);
  }
}

/** 結果の形式（`result_path` の拡張子で判別する） */
type ResultKind = "geojson" | "archive";

/**
 * `result_path` から結果の形式を判定する
 *
 * `result_path` が無い・未知の拡張子のときは判定できないため `undefined` を返す
 * （呼び出し側は要求どおりの形式で取得を試みる）。
 */
const resultKindOf = (job: JobStatusResponse): ResultKind | undefined => {
  const path = job.result_path;
  if (typeof path !== "string") return undefined;
  if (path.endsWith(".zip")) return "archive";
  if (path.endsWith(".geojson")) return "geojson";
  return undefined;
};

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
   * {@link NotFoundError}（`410 GONE`）になる。`lulc` の結果は zip のため
   * {@link JobsResource.resultArchive} を使う。
   *
   * @param jobId ジョブ UUID
   * @returns GeoJSON FeatureCollection
   */
  result(jobId: string): Promise<GeoJSONResponse> {
    return this.api.getJobResult(jobId);
  }

  /**
   * ジョブの結果アーカイブ（zip）をバイト列で取得する（`GET /jobs/{job_id}/result.zip`）
   *
   * `lulc` など結果がファイル一式のジョブ用。`lulc` の zip には `classes.tif`
   * （分類ラスタ）・`class_stats.json`（クラス別面積）・`legend.json`（凡例）・
   * `visual.png`（確認用の描画）が入る。ジョブが `completed` でないと
   * {@link SateaisApiError}（`409 JOB_NOT_COMPLETED`）、保持期間（30日）を過ぎると
   * {@link NotFoundError}（`410 GONE`）になる。
   *
   * @example
   * ```ts
   * import { writeFile } from "node:fs/promises";
   * const zip = await client.jobs.resultArchive(jobId);
   * await writeFile("result.zip", zip);
   * ```
   *
   * @param jobId ジョブ UUID
   * @returns zip ファイルのバイト列
   * @throws {@link SateaisError} 注入された `ApiClient` が `getJobResultArchive` を実装していない場合
   */
  resultArchive(jobId: string): Promise<Uint8Array> {
    const getJobResultArchive = this.api.getJobResultArchive;
    if (getJobResultArchive === undefined) {
      throw new SateaisError(
        "The injected ApiClient does not implement getJobResultArchive, so client.jobs.resultArchive is unavailable",
      );
    }
    return getJobResultArchive.call(this.api, jobId);
  }

  /**
   * ジョブが `completed` になるまでポーリングし、結果 GeoJSON を返す
   *
   * `completed` になったら自動で結果を取得して返す。`failed` に遷移した場合は
   * `errorCode` / `errorMessage` を載せた {@link JobFailedError} を送出する。
   * `timeoutMs` を超過した場合は {@link JobTimeoutError} を送出する。
   * 結果が zip のジョブ（`lulc`）では {@link SateaisError} を送出するため、
   * {@link JobsResource.waitArchive} を使う。
   *
   * @param jobId ジョブ UUID
   * @param options ポーリング間隔・タイムアウト・コールバック
   * @returns 完了したジョブの結果 GeoJSON
   */
  async wait(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<GeoJSONResponse> {
    const job = await this.waitUntilCompleted(jobId, options);
    if (resultKindOf(job) === "archive") {
      throw new SateaisError(
        `Job ${jobId} produces a zip archive (${job.result_path}), not GeoJSON. Use client.jobs.waitArchive or client.jobs.resultArchive instead`,
      );
    }
    return this.api.getJobResult(jobId);
  }

  /**
   * ジョブが `completed` になるまでポーリングし、結果アーカイブ（zip）を返す
   *
   * `lulc` など結果がファイル一式のジョブ用。ポーリング・失敗・タイムアウトの
   * 扱いは {@link JobsResource.wait} と同じ。結果が GeoJSON のジョブでは
   * {@link SateaisError} を送出するため、{@link JobsResource.wait} を使う。
   *
   * @param jobId ジョブ UUID
   * @param options ポーリング間隔・タイムアウト・コールバック
   * @returns 完了したジョブの zip ファイルのバイト列
   */
  async waitArchive(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<Uint8Array> {
    const job = await this.waitUntilCompleted(jobId, options);
    if (resultKindOf(job) === "geojson") {
      throw new SateaisError(
        `Job ${jobId} produces GeoJSON (${job.result_path}), not a zip archive. Use client.jobs.wait or client.jobs.result instead`,
      );
    }
    return this.resultArchive(jobId);
  }

  /**
   * ジョブが `completed` になるまでポーリングし、完了時のステータスを返す
   *
   * @param jobId ジョブ UUID
   * @param options ポーリング間隔・タイムアウト・コールバック
   * @returns `completed` になったジョブのステータス
   * @throws {@link JobFailedError} `failed` などの終端ステータスに遷移した場合
   * @throws {@link JobTimeoutError} `timeoutMs` を超過した場合
   */
  private async waitUntilCompleted(
    jobId: string,
    options: WaitOptions,
  ): Promise<JobStatusResponse> {
    const intervalMs = options.intervalMs ?? 60_000;
    const timeoutMs = options.timeoutMs ?? Number.POSITIVE_INFINITY;
    const start = Date.now();

    for (;;) {
      const job = await this.api.getJob(jobId);
      options.onPoll?.(job);

      if (job.status === "completed") {
        return job;
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
 * 検出ジョブの投入・投入前プレビュー・状態取得・結果取得を提供する。
 *
 * @example
 * ```ts
 * const client = new Client({ apiKey: "sk_live_xxxxx" });
 * // 投入前にクレジット見積もりを確認（polygon 指定時のみ見積もり可能）
 * const aoi = { polygon: "POLYGON((...))", date: "2026-05-01" };
 * const preview = await client.preview.ship(aoi);
 * console.log(preview.credits.estimated, "credits estimated");
 * const job = await client.analyze.ship(aoi);
 * const geojson = await client.jobs.wait(job.job_id);
 * console.log(geojson.features.length, "ships found");
 * ```
 */
export class Client {
  /** 検出リソース（`analyze.ship` / `analyze.lulc` など）。 */
  readonly analyze: AnalyzeResource;
  /** 投入前プレビューリソース（`preview.ship` など。検出メソッドと同名・同パラメータ）。 */
  readonly preview: PreviewResource;
  /** ジョブ操作リソース（状態取得・結果取得・完了待ち）。 */
  readonly jobs: JobsResource;

  constructor(options: ClientOptions = {}) {
    const api = options.apiClient ?? Client.createHttpApiClient(options);

    this.analyze = new AnalyzeResource(api);
    this.preview = new PreviewResource(api);
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
