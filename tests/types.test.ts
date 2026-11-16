/**
 * 検出パラメータの検証ルールと public API の型のテスト
 *
 * 検証ロジック（必須パラメータの組合せ）は実行時に、型の判別・戻り値型は
 * Vitest の `expectTypeOf` で静的に検証する。HTTP には一切触れない。
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { Client } from "../src/client";
import { ValidationError } from "../src/errors";
import type {
  AnalysisEndpoint,
  GeoJSONResponse,
  JobCreateResponse,
  JobStatusResponse,
  PreviewResponse,
} from "../src/types";
import { FakeApiClient } from "./helpers";

const makeClient = (): { client: Client; fake: FakeApiClient } => {
  const fake = new FakeApiClient();
  return { client: new Client({ apiClient: fake }), fake };
};

// analyze / preview はリクエストボディと検証ルールが同一（共有ヘルパー経由）のため、
// 両リソースを同じケース表で検証し、片方だけの変更漏れを検出する。
describe.each(["analyze", "preview"] as const)(
  "検証: %s — ship / oilslick（scene_id か polygon+date）",
  (resource) => {
    it("scene_id も polygon+date も無いと ValidationError", () => {
      const { client, fake } = makeClient();
      // @ts-expect-error 必須パラメータ欠落（実行時検証の対象）
      expect(() => client[resource].ship({})).toThrow(ValidationError);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it("polygon はあるが date が無いと ValidationError", () => {
      const { client } = makeClient();
      expect(() =>
        // @ts-expect-error date 欠落
        client[resource].ship({ polygon: "POLYGON((0 0))" }),
      ).toThrow(ValidationError);
    });

    it("scene_id が空文字なら ValidationError", () => {
      const { client } = makeClient();
      expect(() => client[resource].oilslick({ scene_id: "" })).toThrow(
        ValidationError,
      );
    });

    it("ValidationError は code=VALIDATION_ERROR / status=400 を持つ", () => {
      const { client } = makeClient();
      try {
        // @ts-expect-error 必須欠落
        client[resource].ship({});
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).code).toBe("VALIDATION_ERROR");
        expect((e as ValidationError).status).toBe(400);
      }
    });
  },
);

describe.each(["analyze", "preview"] as const)(
  "検証: %s — newbuilding / disappearbuilding / timeseries（polygon+期間）",
  (resource) => {
    it.each(["newbuilding", "disappearbuilding", "timeseries"] as const)(
      "%s: date_end が無いと ValidationError",
      (endpoint) => {
        const { client, fake } = makeClient();
        expect(() =>
          // @ts-expect-error date_end 欠落
          client[resource][endpoint]({
            polygon: "POLYGON((0 0))",
            date_start: "2026-01-01",
          }),
        ).toThrow(ValidationError);
        expect(fake.submitAnalysis).not.toHaveBeenCalled();
        expect(fake.previewAnalysis).not.toHaveBeenCalled();
      },
    );

    it("polygon が空なら ValidationError", () => {
      const { client } = makeClient();
      expect(() =>
        client[resource].timeseries({
          polygon: "",
          date_start: "2026-01-01",
          date_end: "2026-02-01",
        }),
      ).toThrow(ValidationError);
    });
  },
);

describe.each(["analyze", "preview"] as const)(
  "検証: %s — lulc（polygon+month）",
  (resource) => {
    it("month が無いと ValidationError", () => {
      const { client, fake } = makeClient();
      expect(() =>
        // @ts-expect-error month 欠落
        client[resource].lulc({ polygon: "POLYGON((0 0))" }),
      ).toThrow(ValidationError);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it("polygon が空なら ValidationError", () => {
      const { client } = makeClient();
      expect(() =>
        client[resource].lulc({ polygon: "", month: "2026-08" }),
      ).toThrow(ValidationError);
    });

    it("satellite_id に sentinel-1 は型で拒否され、実行時も ValidationError", () => {
      const { client, fake } = makeClient();
      expect(() =>
        client[resource].lulc({
          polygon: "POLYGON((0 0))",
          month: "2026-08",
          // @ts-expect-error lulc の satellite_id は "sentinel-2" のみ
          satellite_id: "sentinel-1",
        }),
      ).toThrow(ValidationError);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it("orbit_direction を指定すると ValidationError", () => {
      const { client } = makeClient();
      expect(() =>
        client[resource].lulc({
          polygon: "POLYGON((0 0))",
          month: "2026-08",
          // @ts-expect-error lulc は orbit_direction を受け付けない
          orbit_direction: "ascending",
        }),
      ).toThrow(ValidationError);
    });
  },
);

describe.each(["analyze", "preview"] as const)(
  "検証: %s — embankment（polygon+期間、Sentinel-2 版）",
  (resource) => {
    const BASE = {
      polygon: "POLYGON((0 0))",
      date_start: "2025-05-01",
      date_end: "2026-05-01",
    };

    it.each(["polygon", "date_start", "date_end"] as const)(
      "%s が無いと ValidationError",
      (field) => {
        const { client, fake } = makeClient();
        const { [field]: _omitted, ...rest } = BASE;
        expect(() =>
          // @ts-expect-error 必須パラメータ欠落（実行時検証の対象）
          client[resource].embankment(rest),
        ).toThrow(ValidationError);
        expect(fake.submitAnalysis).not.toHaveBeenCalled();
        expect(fake.previewAnalysis).not.toHaveBeenCalled();
      },
    );

    it("satellite_id に sentinel-1 は型で拒否され、実行時も ValidationError", () => {
      const { client, fake } = makeClient();
      expect(() =>
        client[resource].embankment({
          ...BASE,
          // @ts-expect-error embankment の satellite_id は "sentinel-2" のみ
          satellite_id: "sentinel-1",
        }),
      ).toThrow(ValidationError);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it("orbit_direction を指定すると ValidationError", () => {
      const { client, fake } = makeClient();
      expect(() =>
        client[resource].embankment({
          ...BASE,
          // @ts-expect-error embankment は orbit_direction を受け付けない
          orbit_direction: "ascending",
        }),
      ).toThrow(/orbit_direction/);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it.each([
      ["scene_id", "S1A_xxx"],
      ["date", "2026-01-01"],
      ["date_direction", "nearest"],
      ["month", "2026-08"],
      ["before_tif_id", "d38fe8c2-3258-4924-a13a-d2a63de576ca"],
      ["after_tif_id", "5b1f7a0e-8c1d-4a51-9a39-0f3e2a7c9b14"],
    ])("%s を混ぜると ValidationError", (field, value) => {
      const { client, fake } = makeClient();
      const params = { ...BASE, [field]: value };
      expect(() => client[resource].embankment(params)).toThrow(
        ValidationError,
      );
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
      expect(fake.previewAnalysis).not.toHaveBeenCalled();
    });

    it("orbit_direction が undefined ならエラーにせずボディから除く", async () => {
      const { client, fake } = makeClient();
      const params = { ...BASE, orbit_direction: undefined };
      await client[resource].embankment(params);
      const call =
        resource === "analyze"
          ? fake.submitAnalysis.mock.calls[0]
          : fake.previewAnalysis.mock.calls[0];
      expect(call?.[1]).toEqual({ ...BASE, satellite_id: "sentinel-2" });
      expect(call?.[1]).not.toHaveProperty("orbit_direction");
    });
  },
);

describe("型: public API の判別・戻り値型", () => {
  it("AnalysisEndpoint は 7 種の文字列リテラル", () => {
    expectTypeOf<AnalysisEndpoint>().toEqualTypeOf<
      | "ship"
      | "oilslick"
      | "newbuilding"
      | "disappearbuilding"
      | "timeseries"
      | "lulc"
      | "embankment"
    >();
  });

  it("検出メソッドの戻り値は Promise<JobCreateResponse>", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(
      client.analyze.ship,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
    expectTypeOf(
      client.analyze.newbuilding,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
    expectTypeOf(
      client.analyze.lulc,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
    expectTypeOf(
      client.analyze.embankment,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
  });

  it("プレビューメソッドの戻り値は Promise<PreviewResponse>", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(
      client.preview.ship,
    ).returns.resolves.toEqualTypeOf<PreviewResponse>();
    expectTypeOf(
      client.preview.timeseries,
    ).returns.resolves.toEqualTypeOf<PreviewResponse>();
    expectTypeOf(
      client.preview.lulc,
    ).returns.resolves.toEqualTypeOf<PreviewResponse>();
    expectTypeOf(
      client.preview.embankment,
    ).returns.resolves.toEqualTypeOf<PreviewResponse>();
  });

  it("jobs.status / result / wait / resultArchive / waitArchive の戻り値型", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(
      client.jobs.status,
    ).returns.resolves.toEqualTypeOf<JobStatusResponse>();
    expectTypeOf(
      client.jobs.result,
    ).returns.resolves.toEqualTypeOf<GeoJSONResponse>();
    expectTypeOf(
      client.jobs.wait,
    ).returns.resolves.toEqualTypeOf<GeoJSONResponse>();
    expectTypeOf(
      client.jobs.resultArchive,
    ).returns.resolves.toEqualTypeOf<Uint8Array>();
    expectTypeOf(
      client.jobs.waitArchive,
    ).returns.resolves.toEqualTypeOf<Uint8Array>();
  });

  it("analyze.ship は scene_id 単独・polygon+date の双方を受け付ける", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(client.analyze.ship)
      .parameter(0)
      .toMatchTypeOf<
        { scene_id: string } | { polygon: string; date: string }
      >();
  });
});
