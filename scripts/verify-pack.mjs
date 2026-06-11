// npm pack の中身検証スクリプト。
// `npm pack --dry-run --json` が報告する tarball 同梱ファイル一覧に、
// ビルド成果物（ESM / CJS / 型定義）が含まれることを機械的に検証する。
// ユニットテストや tsc をすり抜ける「files 漏れ」「dist 同梱漏れ」を CI で捕まえる狙い。
import { execFileSync } from "node:child_process";

// 同梱されていなければならない最小セット（exports マップが指す実体）
const REQUIRED = [
  "package.json",
  "dist/index.js", // ESM エントリ
  "dist/index.cjs", // CJS エントリ
  "dist/index.d.ts", // ESM 型定義
  "dist/index.d.cts", // CJS 型定義
];

const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});
const meta = JSON.parse(raw);
const entry = Array.isArray(meta) ? meta[0] : meta;
const files = (entry?.files ?? []).map((f) => f.path);

const missing = REQUIRED.filter((req) => !files.includes(req));

if (missing.length > 0) {
  console.error("[verify-pack] error: missing required files in tarball:");
  for (const m of missing) {
    console.error(`  - ${m}`);
  }
  console.error("[verify-pack] packed files were:");
  for (const f of files) {
    console.error(`  + ${f}`);
  }
  process.exit(1);
}

console.log(
  `[verify-pack] ok: all ${REQUIRED.length} required files present in tarball (${files.length} files total)`,
);
