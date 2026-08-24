import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import prisma from "@/lib/db";
import { JobStatus } from "@sakhaa-forge/db";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getAuthenticatedSession } from "@/lib/auth";

async function fetchLogsFromS3(jobId: string): Promise<string[]> {
  const storageProvider = process.env.OBJECT_STORAGE_PROVIDER;
  if (storageProvider !== "s3" && storageProvider !== "b2") return [];

  const endpoint = process.env.AWS_ENDPOINT_URL || process.env.OBJECT_STORAGE_ENDPOINT;
  const region = process.env.AWS_DEFAULT_REGION || process.env.OBJECT_STORAGE_REGION || "eu-central-003";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.OBJECT_STORAGE_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.OBJECT_STORAGE_APPLICATION_KEY;
  const bucket = process.env.B2_BUCKET_PRIVATE_ARTIFACTS || "v0-local-artifacts";

  if (!accessKeyId || !secretAccessKey || !endpoint) return [];

  try {
    const s3Client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: `exports/${jobId}/execution_logs.txt`,
    });

    const response = await s3Client.send(command);
    const bodyStr = await response.Body?.transformToString();
    if (bodyStr) {
      return bodyStr.split("\n").map((l: string) => l.trim()).filter(Boolean);
    }
  } catch (err) {
    console.error("[CONTROL API] Failed to download execution logs from S3:", err);
  }
  return [];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  try {
    const { user, workspace }: any = await getAuthenticatedSession();
    const ws: any = workspace;
    if (!user || !ws) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { job_id } = await params;

    let job = await prisma.job.findUnique({
      where: { id: job_id },
      include: { attempts: true, events: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.workspaceId !== ws.id && !user.isPlatformAdmin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const gpuWorkerUrl = process.env.GPU_WORKER_URL || "http://localhost:8080";
    const workerToken = process.env.GPU_WORKER_TOKEN || "dev-worker-token-123";

    // 1. Try to read execution logs from disk locally first (for local dev mode)
    let logs: string[] = [];
    const localLogPath = path.join(process.cwd(), ".local/storage/v0-local-artifacts/exports", job_id, "execution_logs.txt");
    try {
      const logContent = await fs.readFile(localLogPath, "utf-8");
      logs = logContent.split("\n").map((l: string) => l.trim()).filter(Boolean);
    } catch (err) {
      // Local file not present, try downloading from S3/B2 in production
      const storageProvider = process.env.OBJECT_STORAGE_PROVIDER;
      if (storageProvider === "s3" || storageProvider === "b2") {
        logs = await fetchLogsFromS3(job_id);
      }
    }

    // 2. Pull status and logs from GPU worker if job is active in the database
    if (job.status !== "SUCCEEDED" && job.status !== "FAILED" && job.status !== "CANCELLED") {
      try {
        const response = await fetch(`${gpuWorkerUrl}/api/gpu/jobs/${job_id}`, {
          headers: {
            "Authorization": `Bearer ${workerToken}`,
          },
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          const workerData = await response.json();
          const workerStatus = workerData.status;

          let dbStatus: any = job.status;
          let lastErrorCode = job.lastErrorCode;

          if (workerStatus === "COMPLETED") {
            dbStatus = "SUCCEEDED";
          } else if (workerStatus === "FAILED") {
            dbStatus = "FAILED";
            lastErrorCode = workerData.error_message || "UNKNOWN_ERROR";
          } else {
            dbStatus = "RUNNING"; 
          }

          if (workerData.logs && workerData.logs.length > 0) {
            logs = workerData.logs;
          }

          // If the status changed, update the database
          if (dbStatus !== job.status) {
            job = await prisma.job.update({
              where: { id: job_id },
              data: { 
                status: dbStatus,
                lastErrorCode: lastErrorCode,
              },
              include: { attempts: true, events: true },
            });
          }
          
          // Return the active worker status to the frontend (so it shows friendly progress labels)
          if (dbStatus === "RUNNING") {
            (job as any).status = workerStatus; 
          }
        }
      } catch (err) {
        console.error("[CONTROL API] Failed to fetch active status from GPU worker:", err);
      }
    } else if (logs.length === 0) {
      // 3. Finished but logs not found locally, fetch from the worker as a fallback
      try {
        const response = await fetch(`${gpuWorkerUrl}/api/gpu/jobs/${job_id}`, {
          headers: {
            "Authorization": `Bearer ${workerToken}`,
          },
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const workerData = await response.json();
          logs = workerData.logs || [];
        }
      } catch (err) {
        // Silent catch for completed fallback
      }
    }

    // Map database "SUCCEEDED" to frontend "COMPLETED"
    const jobResponse = { ...job, logs };
    if (jobResponse.status === "SUCCEEDED") {
      jobResponse.status = "COMPLETED" as any;
    }

    return NextResponse.json({ job: jobResponse });
  } catch (error: any) {
    console.error("[CONTROL API] Error in GET job:", error);
    return NextResponse.json(
      { error: "Failed to fetch job", details: error.message },
      { status: 500 }
    );
  }
}
