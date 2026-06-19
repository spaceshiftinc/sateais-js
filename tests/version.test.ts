/**
 * `src/version.ts` の `VERSION` が `package.json` の `version` と一致することを検証する。
 *
 * `VERSION` は手動定数（`User-Agent` ヘッダで利用）のため、リリース時の version 更新と
 * のズレを機械的に防ぐ。
 */

import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { VERSION } from "../src/version";

describe("VERSION", () => {
  it("package.json の version と一致する", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
