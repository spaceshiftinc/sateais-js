/**
 * `http.ts`（HttpApiClient / parseJsonSafe）のユニットテスト
 *
 * グローバル `fetch` をモックし、実 API へは接続しない。Bearer / Content-Type の付与、
 * エラー envelope のマッピング、タイムアウト（AbortController）、
 * NaN を含むレスポンスの安全パースを検証する。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  SateaisApiError,
  SateaisError,
  ValidationError,
} from "../src/errors";
import { HttpApiClient, parseJsonSafe } from "../src/http";
import type { HttpApiClientConfig } from "../src/http";
import { VERSION } from "../src/version";
import { makeResponse } from "./helpers";

/** 既定設定の HttpApiClient を生成する（fetch のみ差し替え） */
const makeClient = (
  fetchImpl: typeof fetch,
  overrides: Partial<HttpApiClientConfig> = {},
): HttpApiClient => {
  return new HttpApiClient({
    apiKey: "sk_test_abc",
    baseUrl: "https://api.example.com/api/v1",
    timeoutMs: 30_000,
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

  it("User-Agent に sateais-js/<version> を付与する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    const client = makeClient(fetchMock);

    await client.getJob("job-1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toMatch(/^sateais-js\/\d+\.\d+\.\d+/);
    expect(init.headers["User-Agent"]).toBe(`sateais-js/${VERSION}`);
  });

  it("submitAnalysis は POST /analyze/{endpoint} に JSON ボディを送る", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, '{"job_id":"j1"}'));
    const client = makeClient(fetchMock);

    const body = { scene_id: "S1A_xxx", satellite_id: "sentinel-1" };
    const res = await client.submitAnalysis("ship", body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/v1/analyze/ship");
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
      const client = makeClient(fetchMock);

      const err = await client.getJob("j1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ErrorClass);
      expect(err).toBeInstanceOf(SateaisApiError);
      expect((err as SateaisApiError).status).toBe(status);
      expect((err as SateaisApiError).code).toBe(code);
      expect((err as SateaisApiError).message).toBe("msg here");
    },
  );

  it("成功(2xx)のボディが非 JSON の場合 SateaisApiError（Invalid JSON）になる", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, "<html>not json</html>"));
    const client = makeClient(fetchMock);

    const err = await client.getJob("j1").catch((e: unknown) => e);
    // ネットワークエラー（SateaisError "Request failed"）ではなく
    // API エラーとして status 付きで分類されること
    expect(err).toBeInstanceOf(SateaisApiError);
    expect((err as SateaisApiError).status).toBe(200);
    expect((err as SateaisApiError).code).toBe("HTTP_200");
    expect((err as Error).message).toContain("Invalid JSON in response body");
  });

  it("envelope でない 5xx は汎用 SateaisApiError（HTTP_ コード）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(500, "Internal Server Error"));
    const client = makeClient(fetchMock);

    const err = await client.getJob("j1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SateaisApiError);
    expect((err as SateaisApiError).code).toBe("HTTP_500");
    expect((err as SateaisApiError).message).toBe("Internal Server Error");
  });
});

describe("HttpApiClient: リトライしない（単発リクエスト）", () => {
  it("5xx は再試行せず 1 回で SateaisApiError を投げる", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503, "down"));
    const client = makeClient(fetchMock);

    await expect(client.getJob("j1")).rejects.toBeInstanceOf(SateaisApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 も再試行せず 1 回で RateLimitError を投げる", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(429, "slow"));
    const client = makeClient(fetchMock);

    await expect(client.getJob("j1")).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("4xx（VALIDATION_ERROR）は 1 回で即時失敗する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(
        400,
        JSON.stringify({
          error: { code: "VALIDATION_ERROR", message: "bad" },
        }),
      ),
    );
    const client = makeClient(fetchMock);

    await expect(client.getJob("j1")).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ネットワークエラーは再試行せず SateaisError を投げる", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    const client = makeClient(fetchMock);

    const err = await client.getJob("j1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SateaisError);
    expect((err as Error).message).toContain("network down");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const client = makeClient(fetchMock, { timeoutMs: 5_000 });

    const promise = client.getJob("j1").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await promise;

    expect(err).toBeInstanceOf(SateaisError);
    expect((err as Error).message).toContain("timed out");
  });
});
