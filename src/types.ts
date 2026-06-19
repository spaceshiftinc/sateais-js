/**
 * SateAIs SDK の公開型定義
 *
 * SateAIs REST API（`https://api.spcsft.com/api/v1`）のリクエスト・レスポンス
 * スキーマを TypeScript の型として表現する。
 */

/** 検出エンドポイント種別 */
export type AnalysisEndpoint =
  | "ship"
  | "oilslick"
  | "newbuilding"
  | "disappearbuilding"
  | "timeseries";

/** 衛星種別（現状は Sentinel-1 のみ対応） */
export type SatelliteId = "sentinel-1";

/** 軌道方向 */
export type OrbitDirection = "ascending" | "descending";

/** シーン選択時の日付方向（`polygon` + `date` パターンで使用） */
export type DateDirection = "before" | "after" | "nearest";

/** ジョブのステータス */
export type JobStatus = "pending" | "processing" | "completed" | "failed";

/**
 * scene_id 入力（フルシーン処理）
 *
 * 既知の Sentinel-1 GRD シーンID を指定してシーン全体を処理する。
 * `ship` / `oilslick` で利用可能。
 */
export interface SceneIdInput {
  /** 衛星種別。省略時は `"sentinel-1"`。 */
  satellite_id?: SatelliteId;
  /** Sentinel-1 GRD シーンID。 */
  scene_id: string;
}

/**
 * polygon + date 入力（シーン自動選択）
 *
 * `date` を基準に ±14日以内で最も近い GRD シーンを自動選択し、polygon でクリップする。
 * `ship` / `oilslick` で利用可能。
 */
export interface PolygonDateInput {
  /** 衛星種別。省略時は `"sentinel-1"`。 */
  satellite_id?: SatelliteId;
  /** AOI ポリゴン（WKT, EPSG:4326）。 */
  polygon: string;
  /** シーン選択の基準日（`YYYY-MM-DD`）。 */
  date: string;
  /** 日付方向。既定は `"nearest"`。 */
  date_direction?: DateDirection;
  /** 軌道方向によるシーン絞り込み。 */
  orbit_direction?: OrbitDirection;
}

/**
 * `ship` / `oilslick` 検出のリクエストパラメータ
 *
 * scene_id 指定（フルシーン）か polygon + date 指定（自動選択）のいずれか。
 */
export type SceneAnalyzeParams = SceneIdInput | PolygonDateInput;

/**
 * `newbuilding` / `disappearbuilding` / `timeseries` 検出のリクエストパラメータ
 *
 * before/after 比較のため 2 期間を指定する polygon + 期間パターンのみ。
 *
 * 面積上限は `newbuilding` / `disappearbuilding` が 30000km²、`timeseries` が 50km²。
 * `timeseries` は加えて `date_start`〜`date_end` が 3 年以内（超過時は API が `ValidationError`）。
 */
export interface PolygonPeriodParams {
  /** 衛星種別。省略時は `"sentinel-1"`。 */
  satellite_id?: SatelliteId;
  /** AOI ポリゴン（WKT, EPSG:4326）。面積上限はエンドポイントごとに異なる。 */
  polygon: string;
  /** 比較対象の前期間の開始日（`YYYY-MM-DD`）。 */
  date_start: string;
  /** 比較対象の後期間の終了日（`YYYY-MM-DD`）。 */
  date_end: string;
  /** 軌道方向によるシーン絞り込み。 */
  orbit_direction?: OrbitDirection;
}

/**
 * 検出ジョブ投入レスポンス（`POST /analyze/{endpoint}`）
 */
export interface JobCreateResponse {
  /** ジョブ UUID。 */
  job_id: string;
  /** 投入直後のステータス（通常 `"pending"`）。 */
  status: JobStatus;
  /** 作成日時（ISO 8601）。 */
  created_at: string;
  /** 完了日時（ISO 8601）。未完了時は `null`。 */
  completed_at: string | null;
  /** 結果 GeoJSON のダウンロードパス。未完了時は `null`。 */
  result_path: string | null;
  /** エラー情報（`pending` 時は `null`）。 */
  error: string | null;
  [key: string]: unknown;
}

/**
 * ジョブステータスレスポンス（`GET /jobs/{job_id}`）
 */
export interface JobStatusResponse {
  /** ジョブ UUID。 */
  job_id: string;
  /** 現在のステータス。 */
  status: JobStatus;
  /** 作成日時（ISO 8601）。 */
  created_at: string;
  /** 完了日時（ISO 8601）。`pending` / `processing` 時は `null`。 */
  completed_at: string | null;
  /** 結果 GeoJSON のダウンロードパス。`completed` 以外では `null`。 */
  result_path: string | null;
  /** 機械可読なエラーコード（`failed` 時）。 */
  error_code: string | null;
  /** 人間可読なエラー詳細（`failed` 時）。 */
  error_message: string | null;
  /**
   * @deprecated `error_code` を使用すること。後方互換のため `error_code` と同値を返す。
   */
  error: string | null;
  [key: string]: unknown;
}

/** GeoJSON Geometry */
export interface GeoJSONGeometry {
  type: string;
  coordinates: unknown;
  [key: string]: unknown;
}

/** GeoJSON Feature */
export interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown> | null;
  id?: string | number;
  [key: string]: unknown;
}

/**
 * GeoJSON FeatureCollection（検出結果, `GET /jobs/{job_id}/result.geojson`）
 *
 * 検出が無かった場合 `features` は空配列になる。
 */
export interface GeoJSONResponse {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
  crs?: {
    type: string;
    properties: Record<string, unknown>;
  };
  [key: string]: unknown;
}

/** エラー envelope（同期エラー `{ "error": { "code", "message" } }`） */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}
