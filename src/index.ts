/**
 * `@sateais/sdk` エントリポイント
 *
 * SateAIs REST API（Sentinel-1 SAR 検出）の TypeScript SDK。
 */

export {
  Client,
  SceneDetectionResource,
  PolygonPeriodDetectionResource,
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
  DetectionEndpoint,
  SatelliteId,
  OrbitDirection,
  DateDirection,
  JobStatus,
  SceneIdInput,
  PolygonDateInput,
  SceneDetectParams,
  PolygonPeriodParams,
  JobCreateResponse,
  JobStatusResponse,
  GeoJSONGeometry,
  GeoJSONFeature,
  GeoJSONResponse,
  ApiErrorEnvelope,
} from "./types";
