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
} from "../src/types";
import { FakeApiClient } from "./helpers";

const makeClient = (): { client: Client; fake: FakeApiClient } => {
  const fake = new FakeApiClient();
  return { client: new Client({ apiClient: fake }), fake };
};

describe("検証: ship / oilslick（scene_id か polygon+date）", () => {
  it("scene_id も polygon+date も無いと ValidationError", () => {
    const { client, fake } = makeClient();
    // @ts-expect-error 必須パラメータ欠落（実行時検証の対象）
    expect(() => client.ship.analyze({})).toThrow(ValidationError);
    expect(fake.submitAnalysis).not.toHaveBeenCalled();
  });

  it("polygon はあるが date が無いと ValidationError", () => {
    const { client } = makeClient();
    // @ts-expect-error date 欠落
    expect(() => client.ship.analyze({ polygon: "POLYGON((0 0))" })).toThrow(
      ValidationError,
    );
  });

  it("scene_id が空文字なら ValidationError", () => {
    const { client } = makeClient();
    expect(() => client.oilslick.analyze({ scene_id: "" })).toThrow(
      ValidationError,
    );
  });

  it("ValidationError は code=VALIDATION_ERROR / status=400 を持つ", () => {
    const { client } = makeClient();
    try {
      // @ts-expect-error 必須欠落
      client.ship.analyze({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("VALIDATION_ERROR");
      expect((e as ValidationError).status).toBe(400);
    }
  });
});

describe("検証: newbuilding / disappearbuilding / timeseries（polygon+期間）", () => {
  it.each(["newbuilding", "disappearbuilding", "timeseries"] as const)(
    "%s: date_end が無いと ValidationError",
    (endpoint) => {
      const { client, fake } = makeClient();
      expect(() =>
        // @ts-expect-error date_end 欠落
        client[endpoint].analyze({
          polygon: "POLYGON((0 0))",
          date_start: "2026-01-01",
        }),
      ).toThrow(ValidationError);
      expect(fake.submitAnalysis).not.toHaveBeenCalled();
    },
  );

  it("polygon が空なら ValidationError", () => {
    const { client } = makeClient();
    expect(() =>
      client.timeseries.analyze({
        polygon: "",
        date_start: "2026-01-01",
        date_end: "2026-02-01",
      }),
    ).toThrow(ValidationError);
  });
});

describe("型: public API の判別・戻り値型", () => {
  it("AnalysisEndpoint は 5 種の文字列リテラル", () => {
    expectTypeOf<AnalysisEndpoint>().toEqualTypeOf<
      "ship" | "oilslick" | "newbuilding" | "disappearbuilding" | "timeseries"
    >();
  });

  it("検出メソッドの戻り値は Promise<JobCreateResponse>", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(
      client.ship.analyze,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
    expectTypeOf(
      client.newbuilding.analyze,
    ).returns.resolves.toEqualTypeOf<JobCreateResponse>();
  });

  it("jobs.status / result / wait の戻り値型", () => {
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
  });

  it("ship.analyze は scene_id 単独・polygon+date の双方を受け付ける", () => {
    const client = new Client({ apiClient: new FakeApiClient() });
    expectTypeOf(client.ship.analyze)
      .parameter(0)
      .toMatchTypeOf<
        { scene_id: string } | { polygon: string; date: string }
      >();
  });
});
