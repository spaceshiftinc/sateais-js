/**
 * `client.ts`（Client / 検出リソース / JobsResource）のユニットテスト
 *
 * 検出メソッドのボディ生成は Fake な {@link ApiClient} を注入して検証し、
 * HTTP 配線（baseUrl・Bearer・apiKey 解決）はグローバル `fetch` をモックして検証する。
 * `jobs.wait` のポーリングは Vitest の fake timers で制御する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client";
import {
  AuthenticationError,
  JobFailedError,
  JobTimeoutError,
} from "../src/errors";
import type {
  GeoJSONResponse,
  JobCreateResponse,
  JobStatus,
  JobStatusResponse,
} from "../src/types";
import { FakeApiClient, makeResponse } from "./helpers";

/** ジョブステータスレスポンスのファクトリ */
const jobStatus = (
  status: JobStatus,
  extra: Partial<JobStatusResponse> = {},
): JobStatusResponse => ({
  job_id: "j1",
  status,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  result_path: null,
  error_code: null,
  error_message: null,
  error: null,
  ...extra,
});

const JOB_CREATE: JobCreateResponse = {
  job_id: "j1",
  status: "pending",
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  result_path: null,
  error: null,
};

const GEOJSON: GeoJSONResponse = { type: "FeatureCollection", features: [] };

/** @types/node に依存せず process.env を参照する（src と同じ方針） */
const processEnv = (
  globalThis as unknown as {
    process: { env: Record<string, string | undefined> };
  }
).process.env;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Client: HTTP 配線（fetch モック）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
  });

  it("baseUrl の既定値が使われる", async () => {
    const client = new Client({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.jobs.status("j1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.spcsft.com/api/v1/jobs/j1",
    );
  });

  it("baseUrl の上書きが効き、末尾スラッシュは除去される", async () => {
    const client = new Client({
      apiKey: "k",
      baseUrl: "https://custom.test/v9/",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.jobs.status("j1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://custom.test/v9/jobs/j1");
  });

  it("Bearer ヘッダに apiKey が載る", async () => {
    const client = new Client({
      apiKey: "sk_live_xyz",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.jobs.status("j1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer sk_live_xyz",
    );
  });
});

describe("Client: apiKey の解決", () => {
  const ENV_KEY = "SATEAIS_API_KEY";
  let original: string | undefined;

  beforeEach(() => {
    original = processEnv[ENV_KEY];
    delete processEnv[ENV_KEY];
  });
  afterEach(() => {
    if (original === undefined) delete processEnv[ENV_KEY];
    else processEnv[ENV_KEY] = original;
  });

  it("apiKey も環境変数も無いと AuthenticationError", () => {
    expect(() => new Client()).toThrow(AuthenticationError);
  });

  it("環境変数 SATEAIS_API_KEY から解決される", async () => {
    processEnv[ENV_KEY] = "env_key";
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    const client = new Client({ fetch: fetchMock as unknown as typeof fetch });
    await client.jobs.status("j1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer env_key",
    );
  });

  it("引数 apiKey が環境変数より優先される", async () => {
    processEnv[ENV_KEY] = "env_key";
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    const client = new Client({
      apiKey: "arg_key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.jobs.status("j1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer arg_key",
    );
  });
});

describe("検出メソッド（Fake ApiClient）", () => {
  let fake: FakeApiClient;
  let client: Client;

  beforeEach(() => {
    fake = new FakeApiClient();
    fake.submitAnalysis.mockResolvedValue(JOB_CREATE);
    client = new Client({ apiClient: fake });
  });

  it("ship: scene_id パターンのボディを POST /analyze/ship 相当に送る", async () => {
    const res = await client.ship.analyze({ scene_id: "S1A_IW_GRDH_xxx" });
    expect(fake.submitAnalysis).toHaveBeenCalledWith("ship", {
      scene_id: "S1A_IW_GRDH_xxx",
      satellite_id: "sentinel-1",
    });
    expect(res).toEqual(JOB_CREATE);
  });

  it("ship: polygon + date パターンのボディを送る", async () => {
    await client.ship.analyze({
      polygon: "POLYGON((0 0,1 0,1 1,0 0))",
      date: "2026-01-10",
      date_direction: "nearest",
    });
    expect(fake.submitAnalysis).toHaveBeenCalledWith("ship", {
      polygon: "POLYGON((0 0,1 0,1 1,0 0))",
      date: "2026-01-10",
      date_direction: "nearest",
      satellite_id: "sentinel-1",
    });
  });

  it("oilslick: scene_id パターンで /analyze/oilslick に送る", async () => {
    await client.oilslick.analyze({ scene_id: "S1A_yyy" });
    expect(fake.submitAnalysis).toHaveBeenCalledWith("oilslick", {
      scene_id: "S1A_yyy",
      satellite_id: "sentinel-1",
    });
  });

  it("satellite_id を明示指定するとそれが尊重される", async () => {
    await client.ship.analyze({
      scene_id: "S1A_zzz",
      satellite_id: "sentinel-1",
    });
    expect(fake.submitAnalysis.mock.calls[0][1].satellite_id).toBe(
      "sentinel-1",
    );
  });

  it.each(["newbuilding", "disappearbuilding", "timeseries"] as const)(
    "%s: polygon + date_start + date_end のボディを送る",
    async (endpoint) => {
      await client[endpoint].analyze({
        polygon: "POLYGON((0 0,1 0,1 1,0 0))",
        date_start: "2026-01-01",
        date_end: "2026-02-01",
      });
      expect(fake.submitAnalysis).toHaveBeenCalledWith(endpoint, {
        polygon: "POLYGON((0 0,1 0,1 1,0 0))",
        date_start: "2026-01-01",
        date_end: "2026-02-01",
        satellite_id: "sentinel-1",
      });
    },
  );

  it("レスポンスが JobCreateResponse として返る", async () => {
    const res = await client.ship.analyze({ scene_id: "S1A_xxx" });
    expect(res.job_id).toBe("j1");
    expect(res.status).toBe("pending");
  });
});

describe("JobsResource: status / result", () => {
  let fake: FakeApiClient;
  let client: Client;

  beforeEach(() => {
    fake = new FakeApiClient();
    client = new Client({ apiClient: fake });
  });

  it("status(id) が getJob を叩き JobStatusResponse を返す", async () => {
    fake.getJob.mockResolvedValue(jobStatus("processing"));
    const res = await client.jobs.status("j1");
    expect(fake.getJob).toHaveBeenCalledWith("j1");
    expect(res.status).toBe("processing");
  });

  it("result(id) が getJobResult を叩き GeoJSON を返す", async () => {
    fake.getJobResult.mockResolvedValue(GEOJSON);
    const res = await client.jobs.result("j1");
    expect(fake.getJobResult).toHaveBeenCalledWith("j1");
    expect(res).toEqual(GEOJSON);
  });
});

describe("JobsResource.wait（fake timers）", () => {
  let fake: FakeApiClient;
  let client: Client;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = new FakeApiClient();
    client = new Client({ apiClient: fake });
  });

  it("pending → processing → completed で結果を返し、onPoll が毎回呼ばれる", async () => {
    fake.getJob
      .mockResolvedValueOnce(jobStatus("pending"))
      .mockResolvedValueOnce(jobStatus("processing"))
      .mockResolvedValueOnce(jobStatus("completed"));
    fake.getJobResult.mockResolvedValue(GEOJSON);
    const onPoll = vi.fn();

    const promise = client.jobs.wait("j1", { intervalMs: 1_000, onPoll });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res).toEqual(GEOJSON);
    expect(fake.getJob).toHaveBeenCalledTimes(3);
    expect(onPoll).toHaveBeenCalledTimes(3);
    expect(fake.getJobResult).toHaveBeenCalledWith("j1");
  });

  it("failed で error_code / error_message を載せて JobFailedError を投げる", async () => {
    fake.getJob.mockResolvedValue(
      jobStatus("failed", {
        error_code: "INFERENCE_FAILED",
        error_message: "model crashed",
        error: "INFERENCE_FAILED",
      }),
    );

    const promise = client.jobs
      .wait("j1", { intervalMs: 1_000 })
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).errorCode).toBe("INFERENCE_FAILED");
    expect((err as JobFailedError).errorMessage).toBe("model crashed");
    expect((err as JobFailedError).jobId).toBe("j1");
  });

  it("timeoutMs 超過で JobTimeoutError を投げる", async () => {
    fake.getJob.mockResolvedValue(jobStatus("pending"));

    const promise = client.jobs
      .wait("j1", { intervalMs: 1_000, timeoutMs: 2_000 })
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(JobTimeoutError);
    expect((err as JobTimeoutError).jobId).toBe("j1");
  });

  it("各ポーリング間隔で getJob が呼ばれる（intervalMs を尊重）", async () => {
    fake.getJob
      .mockResolvedValueOnce(jobStatus("pending"))
      .mockResolvedValueOnce(jobStatus("completed"));
    fake.getJobResult.mockResolvedValue(GEOJSON);

    const promise = client.jobs.wait("j1", { intervalMs: 5_000 });
    // 1 回目のポーリングは即時
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.getJob).toHaveBeenCalledTimes(1);
    // interval 経過で 2 回目
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(fake.getJob).toHaveBeenCalledTimes(2);
  });
});
