/**
 * `http.ts`（HttpApiClient / parseJsonSafe）のユニットテスト
 *
 * グローバル `fetch` をモックし、実 API へは接続しない。Bearer / Content-Type の付与、
 * エラー envelope のマッピング、指数バックオフリトライ、タイムアウト（AbortController）、
 * NaN を含むレスポンスの安全パースを検証する。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpApiClient, parseJsonSafe } from "../src/http";
import type { HttpApiClientConfig } from "../src/http";
import {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  SateaisApiError,
  SateaisError,
  ValidationError,
} from "../src/errors";

/** テスト用の最小 Response モックを生成する */
const makeResponse = (
  status: number,
  body: string,
  statusText = "",
): Response => {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  } as unknown as Response;
};

/** 既定設定の HttpApiClient を生成する（fetch のみ差し替え） */
const makeClient = (
  fetchImpl: typeof fetch,
  overrides: Partial<HttpApiClientConfig> = {},
): HttpApiClient => {
  return new HttpApiClient({
    apiKey: "sk_test_abc",
    baseUrl: "https://api.example.com/api/v1",
    timeoutMs: 30_000,
    maxRetries: 4,
    retryInitialDelayMs: 1_000,
    retryMaxDelayMs: 30_000,
    fetch: fetchImpl,
    ...overrides,
  });
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseJsonSafe", () => {
  it("通常の JSON をパースできる", () => {
    expect(parseJsonSafe<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("`:NaN` を null に置換してパースする", () => {
    const result = parseJsonSafe<{ score: number | null; n: number }>(
      '{"score": NaN, "n": 3}',
    );
    expect(result).toEqual({ score: null, n: 3 });
  });

  it("複数の NaN・空白付きの NaN を置換する", () => {
    const result = parseJsonSafe<{ a: null; b: null; c: number }>(
      '{"a":NaN, "b":   NaN, "c": 2}',
    );
    expect(result).toEqual({ a: null, b: null, c: 2 });
  });
});

describe("HttpApiClient: ヘッダ・URL・ボディ", () => {
  it("Bearer ヘッダと Content-Type を付与する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    const client = makeClient(fetchMock);

    await client.getJob("job-1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk_test_abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("submitDetection は POST /detect/{endpoint} に JSON ボディを送る", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, '{"job_id":"j1"}'));
    const client = makeClient(fetchMock);

    const body = { scene_id: "S1A_xxx", satellite_id: "sentinel-1" };
    const res = await client.submitDetection("ship", body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/v1/detect/ship");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(res).toEqual({ job_id: "j1" });
  });

  it("GET 系はボディを送らず、jobId を URL エンコードする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    const client = makeClient(fetchMock);

    await client.getJob("a/b c");
    await client.getJobResult("a/b c");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/api/v1/jobs/a%2Fb%20c",
    );
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.example.com/api/v1/jobs/a%2Fb%20c/result.geojson",
    );
  });

  it("NaN を含む 200 レスポンスを安全にパースする", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, '{"score": NaN, "ok": true}'));
    const client = makeClient(fetchMock);

    const res = (await client.getJobResult("j1")) as unknown as {
      score: number | null;
      ok: boolean;
    };
    expect(res).toEqual({ score: null, ok: true });
  });
});

describe("HttpApiClient: エラー envelope のマッピング", () => {
  const envelope = (code: string, message: string): string =>
    JSON.stringify({ error: { code, message } });

  it.each([
    [400, ValidationError, "VALIDATION_ERROR"],
    [401, AuthenticationError, "UNAUTHORIZED"],
    [403, AuthenticationError, "FORBIDDEN"],
    [402, InsufficientCreditsError, "INSUFFICIENT_CREDITS"],
    [404, NotFoundError, "NOT_FOUND"],
    [410, NotFoundError, "GONE"],
    [429, RateLimitError, "RATE_LIMITED"],
  ])(
    "%i → 対応する例外（code/status/message を保持）",
    async (status, ErrorClass, code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeResponse(status, envelope(code, "msg here")));
      // 429 はリトライ対象なので maxRetries:0 で即時失敗させる
      const client = makeClient(fetchMock, { maxRetries: 0 });

      const err = await client.getJob("j1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ErrorClass);
      expect(err).toBeInstanceOf(SateaisApiError);
      expect((err as SateaisApiError).status).toBe(status);
      expect((err as SateaisApiError).code).toBe(code);
      expect((err as SateaisApiError).message).toBe("msg here");
    },
  );

  it("envelope でない 5xx は汎用 SateaisApiError（HTTP_ コード）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(500, "Internal Server Error"));
    const client = makeClient(fetchMock, { maxRetries: 0 });

    const err = await client.getJob("j1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SateaisApiError);
    expect((err as SateaisApiError).code).toBe("HTTP_500");
    expect((err as SateaisApiError).message).toBe("Internal Server Error");
  });
});

describe("HttpApiClient: リトライと指数バックオフ", () => {
  it("503 → 200 でリトライして成功する", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503, "down"))
      .mockResolvedValueOnce(makeResponse(200, '{"job_id":"j1"}'));
    const client = makeClient(fetchMock);

    const promise = client.getJob("j1");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res).toEqual({ job_id: "j1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 / 504 もリトライ対象", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "slow"))
      .mockResolvedValueOnce(makeResponse(504, "gw"))
      .mockResolvedValueOnce(makeResponse(200, "{}"));
    const client = makeClient(fetchMock);

    const promise = client.getJob("j1");
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("4xx（VALIDATION_ERROR）は即時失敗しリトライしない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeResponse(
          400,
          JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "bad" } }),
        ),
      );
    const client = makeClient(fetchMock);

    await expect(client.getJob("j1")).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ネットワークエラーをリトライし、最終的に SateaisError を投げる", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    const client = makeClient(fetchMock, { maxRetries: 2 });

    const promise = client.getJob("j1").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(SateaisError);
    expect((err as Error).message).toContain("network down");
    // 初回 + リトライ 2 回 = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("指数バックオフ: 待機時間が 1s, 2s と倍増する", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503, "x"))
      .mockResolvedValueOnce(makeResponse(503, "x"))
      .mockResolvedValueOnce(makeResponse(200, "{}"));
    const client = makeClient(fetchMock, {
      retryInitialDelayMs: 1_000,
      retryMaxDelayMs: 30_000,
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = client.getJob("j1");
    await vi.runAllTimersAsync();
    await promise;

    // sleep のための setTimeout 呼び出し（タイムアウト用は別途あるため delay で抽出）
    const sleepDelays = setTimeoutSpy.mock.calls
      .map((c) => c[1])
      .filter((d) => d === 1_000 || d === 2_000);
    expect(sleepDelays).toEqual([1_000, 2_000]);
  });
});

describe("HttpApiClient: タイムアウト（AbortController）", () => {
  it("timeoutMs 経過で abort され、SateaisError（timed out）になる", async () => {
    vi.useFakeTimers();
    // signal の abort を受けて AbortError で reject する fetch
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetchMock, { maxRetries: 0, timeoutMs: 5_000 });

    const promise = client.getJob("j1").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await promise;

    expect(err).toBeInstanceOf(SateaisError);
    expect((err as Error).message).toContain("timed out");
  });
});
