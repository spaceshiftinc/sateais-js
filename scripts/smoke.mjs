// ESM スモークテスト: install 済みの @sateais/sdk を ESM 形式で読み込み、
// 主要 public シンボルの存在と Client のインスタンス化を検証する。
// Verdaccio 検証ワークフローから、クリーンな install 先で実行される。
import assert from "node:assert/strict";
import { Client, SateaisError } from "@sateais/sdk";

assert.equal(typeof Client, "function", "Client should be a constructor");
assert.equal(
  typeof SateaisError,
  "function",
  "SateaisError should be exported",
);

const client = new Client({ apiKey: "test" });
assert.ok(client, "new Client({ apiKey }) should instantiate");

console.log("[smoke:esm] ok: Client instantiated via ESM import");
