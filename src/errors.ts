/**
 * SateAIs SDK の例外階層
 *
 * ```
 * SateaisError                         （基底）
 * ├── SateaisApiError                  （HTTP エラー: status / code / message）
 * │   ├── AuthenticationError          （401 / 403、API キー未解決）
 * │   ├── ValidationError              （400）
 * │   ├── InsufficientCreditsError     （402）
 * │   ├── NotFoundError                （404 / 410）
 * │   └── RateLimitError               （429）
 * ├── ResponseParseError               （2xx 応答ボディの JSON パース失敗: status）
 * ├── JobFailedError                   （wait() 中に failed: errorCode / errorMessage）
 * └── JobTimeoutError                  （wait() タイムアウト）
 * ```
 */

/** SateAIs SDK が送出する全例外の基底クラス */
export class SateaisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SateaisError";
    // ターゲットが ES5 にトランスパイルされた場合の instanceof 対策
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** {@link SateaisApiError} のコンストラクタ引数 */
export interface ApiErrorOptions {
  /** 機械可読なエラーコード（例: `VALIDATION_ERROR`）。 */
  code: string;
  /** 人間可読なエラーメッセージ。 */
  message: string;
  /** HTTP ステータスコード。 */
  status: number;
}

/**
 * API がエラー envelope（`{ "error": { "code", "message" } }`）を返した場合の例外
 *
 * 同期エラー（4xx / 5xx）を表す。`code` / `status` / `message` を保持する。
 * 特定のステータスは下位クラス（{@link AuthenticationError} など）にマッピングされる。
 */
export class SateaisApiError extends SateaisError {
  /** 機械可読なエラーコード（例: `VALIDATION_ERROR`, `INSUFFICIENT_CREDITS`）。 */
  readonly code: string;
  /** HTTP ステータスコード。 */
  readonly status: number;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = "SateaisApiError";
    this.code = options.code;
    this.status = options.status;
  }
}

/** 認証エラー（`401` / `403`、または API キー未解決）。 */
export class AuthenticationError extends SateaisApiError {
  constructor(options: ApiErrorOptions) {
    super(options);
    this.name = "AuthenticationError";
  }
}

/** バリデーションエラー（`400`、必須パラメータ不正など）。 */
export class ValidationError extends SateaisApiError {
  constructor(options: ApiErrorOptions) {
    super(options);
    this.name = "ValidationError";
  }
}

/** クレジット不足エラー（`402`）。 */
export class InsufficientCreditsError extends SateaisApiError {
  constructor(options: ApiErrorOptions) {
    super(options);
    this.name = "InsufficientCreditsError";
  }
}

/** リソース未検出エラー（`404` / `410`、結果の保持期限切れを含む）。 */
export class NotFoundError extends SateaisApiError {
  constructor(options: ApiErrorOptions) {
    super(options);
    this.name = "NotFoundError";
  }
}

/** レート制限エラー（`429`）。 */
export class RateLimitError extends SateaisApiError {
  constructor(options: ApiErrorOptions) {
    super(options);
    this.name = "RateLimitError";
  }
}

/**
 * 2xx 応答のボディが JSON としてパースできなかった場合の例外
 *
 * これは API のアプリケーションエラー（{@link SateaisApiError}）ではなく、
 * transport / パース層の問題を表す。サーバが想定外の非 JSON を返した場合などに
 * 送出され、`HTTP_<status>` のような誤解を招くコードは持たない。
 *
 * なお `204 No Content` / `205 Reset Content` や空ボディの 2xx は「正常な空応答」
 * として扱われ、本例外は送出されない（`undefined` が返る）。
 */
export class ResponseParseError extends SateaisError {
  /** パースに失敗した応答の HTTP ステータスコード。 */
  readonly status: number;

  constructor(options: { status: number; message: string }) {
    super(options.message);
    this.name = "ResponseParseError";
    this.status = options.status;
  }
}

/**
 * ジョブが `failed` に遷移した場合の例外（`jobs.wait` で送出）
 *
 * 非同期ジョブ失敗は `error_code` / `error_message` のフラットフィールドで返るため、
 * それらを `errorCode` / `errorMessage` として保持して送出する。
 */
export class JobFailedError extends SateaisError {
  /** 失敗したジョブの UUID。 */
  readonly jobId: string;
  /** 機械可読なエラーコード（API の `error_code`）。 */
  readonly errorCode: string | null;
  /** 人間可読なエラー詳細（API の `error_message`）。 */
  readonly errorMessage: string | null;

  constructor(options: {
    jobId: string;
    errorCode: string | null;
    errorMessage: string | null;
  }) {
    super(
      options.errorMessage ??
        `Job ${options.jobId} failed (${options.errorCode ?? "UNKNOWN"})`,
    );
    this.name = "JobFailedError";
    this.jobId = options.jobId;
    this.errorCode = options.errorCode;
    this.errorMessage = options.errorMessage;
  }
}

/**
 * `jobs.wait` がタイムアウトした場合の例外
 *
 * ジョブ自体は失敗していないが、指定 `timeoutMs` 内に完了しなかったことを表す。
 */
export class JobTimeoutError extends SateaisError {
  /** タイムアウトしたジョブの UUID。 */
  readonly jobId: string;

  constructor(options: { jobId: string; timeoutMs: number }) {
    super(
      `Timed out after ${options.timeoutMs}ms waiting for job ${options.jobId} to complete`,
    );
    this.name = "JobTimeoutError";
    this.jobId = options.jobId;
  }
}
