// 型解決スモーク: install 済みの @sateais/sdk の型定義が解決でき、
// public な型・値が期待どおりの形であることを tsc でコンパイルして検証する。
import {
  type AnalysisEndpoint,
  Client,
  type JobStatusResponse,
  SateaisApiError,
  SateaisError,
} from "@sateais/sdk";

// Client が apiKey オプションでインスタンス化でき、型が付くこと
const client: Client = new Client({ apiKey: "test" });
void client;

// 公開型が解決され、リテラルが型に適合すること
const endpoint: AnalysisEndpoint = "ship";
void endpoint;

// レスポンス型のフィールド型が解決されること（status は文字列リテラル合併）
const status: JobStatusResponse["status"] = "completed";
void status;

// 例外階層の継承関係が型レベルで解決されること
const err: SateaisError = new SateaisApiError({
  code: "VALIDATION_ERROR",
  message: "x",
  status: 400,
});
void err;
