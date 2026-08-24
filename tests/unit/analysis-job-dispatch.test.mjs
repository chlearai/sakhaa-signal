import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALLOWED_ANALYSIS_MODELS,
  getAnalysisStages,
  INITIAL_ANALYSIS_JOB_STATE,
} from "../../packages/contracts/src/analysis-stages.ts";

test("new standard analysis jobs enter the worker's eligible queue", () => {
  assert.deepEqual(INITIAL_ANALYSIS_JOB_STATE, {
    status: "QUEUED",
    currentStage: "DOWNLOAD_AND_VALIDATE",
    progressPercent: 0,
  });
});

test("static stage contract matches the CPU worker", () => {
  assert.deepEqual(getAnalysisStages("STATIC_STANDARD"), [
    "DOWNLOAD_AND_VALIDATE",
    "PREPROCESSING",
    "COMPUTER_VISION",
    "RULE_EVALUATION",
    "DETERMINISTIC_SCORING",
    "MULTIMODAL_GPT_SYNTHESIS",
    "REPORT_PUBLISHING",
  ]);
});

test("standard-video stage contract matches the CPU worker", () => {
  assert.deepEqual(getAnalysisStages("VIDEO_STANDARD"), [
    "DOWNLOAD_AND_VALIDATE",
    "PREPROCESSING",
    "COMPUTER_VISION",
    "DETERMINISTIC_SCORING",
    "MULTIMODAL_GPT_SYNTHESIS",
    "REPORT_PUBLISHING",
  ]);
});

test("CPU worker recovers analysis jobs stranded in CREATED", () => {
  const workerSource = readFileSync("workers/cpu/src/index.ts", "utf8");
  assert.match(workerSource, /\{ status: "CREATED" \}/);
  assert.match(workerSource, /\{ status: "QUEUED" \}/);
});

test("static OpenAI vision calls have bounded latency and explicit reasoning", () => {
  const visionSource = readFileSync(
    "packages/engines/src/openai/openai-vision.ts",
    "utf8"
  );
  assert.match(visionSource, /OPENAI_VISION_TIMEOUT_MS/);
  assert.match(visionSource, /maxRetries: 1/);
  assert.match(visionSource, /reasoning_effort = "none"/);
});

test("analysis API validates a server-owned vision model allowlist", () => {
  assert.deepEqual(ALLOWED_ANALYSIS_MODELS, ["gpt-4o", "gpt-5.6-sol", "gpt-4o-mini"]);
  const routeSource = readFileSync(
    "apps/web/src/app/api/analysis/jobs/route.ts",
    "utf8"
  );
  assert.match(routeSource, /isAllowedAnalysisModel\(model\)/);
  assert.match(routeSource, /selectedModel: model/);
});

test("worker heartbeats active leases and streams B2 downloads", () => {
  const workerSource = readFileSync("workers/cpu/src/index.ts", "utf8");
  const storageSource = readFileSync("workers/cpu/src/storage/b2-adapter.ts", "utf8");
  assert.match(workerSource, /LEASE_HEARTBEAT_MS/);
  assert.match(workerSource, /Promise\.all/);
  assert.doesNotMatch(workerSource, /job\.mode === "FULL_WITH_TRIBEV2"/);
  assert.match(storageSource, /pipeline\(response\.Body/);
  assert.doesNotMatch(storageSource, /Buffer\.concat\(chunks\)/);
});

test("production upload and artifact view routes use signed B2 URLs", () => {
  const presignSource = readFileSync("apps/web/src/app/api/uploads/presign/route.ts", "utf8");
  const completionSource = readFileSync("apps/web/src/app/api/uploads/complete/route.ts", "utf8");
  const viewSource = readFileSync("apps/web/src/app/api/artifacts/[artifactId]/view/route.ts", "utf8");
  const b2Source = readFileSync("apps/web/src/lib/b2.ts", "utf8");
  assert.match(presignSource, /PutObjectCommand/);
  assert.doesNotMatch(presignSource, /ContentLength:\s*sizeInBytes/, "Presign route must not pass ContentLength to PutObjectCommand as it breaks browser fetch CORS/signed headers");
  assert.match(b2Source, /requestChecksumCalculation:\s*"WHEN_REQUIRED"/, "B2 client must disable default flexible checksum calculation on presigned URLs");
  assert.match(completionSource, /HeadObjectCommand/);
  assert.match(completionSource, /status: "CLEAN"/);
  assert.match(viewSource, /GetObjectCommand/);
  assert.match(viewSource, /NextResponse\.redirect/);
});
