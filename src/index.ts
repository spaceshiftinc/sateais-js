/**
 * `@sateais/sdk` エントリポイント
 *
 * SateAIs REST API（Sentinel-1 SAR 検出）の TypeScript SDK。
 */

export {
  Client,
  SceneAnalysisResource,
  PolygonPeriodAnalysisResource,
  JobsResource,
} from "./client";
export type { ClientOptions, WaitOptions } from "./client";

export { HttpApiClient, parseJsonSafe } from "./http";
export type { ApiClient, HttpApiClientConfig } from "./http";

export {
  SateaisError,
  SateaisApiError,
  AuthenticationError,
  ValidationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  JobFailedError,
  JobTimeoutError,
} from "./errors";
export type { ApiErrorOptions } from "./errors";

export type {
  AnalysisEndpoint,
  SatelliteId,
  OrbitDirection,
  DateDirection,
  JobStatus,
  SceneIdInput,
  PolygonDateInput,
  SceneAnalyzeParams,
  PolygonPeriodParams,
  JobCreateResponse,
  JobStatusResponse,
  GeoJSONGeometry,
  GeoJSONFeature,
  GeoJSONResponse,
  ApiErrorEnvelope,
} from "./types";
