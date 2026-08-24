import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import prisma from "@/lib/db";
import { getAuthenticatedSession } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  try {
    const { user, workspace: ws } = await getAuthenticatedSession();
    if (!user || !ws) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { job_id } = await params;

    const job = await prisma.job.findUnique({
      where: { id: job_id },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.workspaceId !== ws.id && !user.isPlatformAdmin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Extract contentType from body, default to application/octet-stream
    let contentType = "application/octet-stream";
    try {
      const body = await req.json();
      if (body && body.contentType) {
        contentType = body.contentType;
      }
    } catch (err) {
      // Body may be empty, proceed with default
    }

    const objectKey = `uploads/${job_id}/original_video.mp4`;
    let uploadUrl = "";

    const storageProvider = process.env.OBJECT_STORAGE_PROVIDER || "local-filesystem";

    if (storageProvider === "s3" || storageProvider === "b2") {
      const endpoint = process.env.AWS_ENDPOINT_URL || process.env.OBJECT_STORAGE_ENDPOINT;
      const region = process.env.AWS_DEFAULT_REGION || process.env.OBJECT_STORAGE_REGION || "eu-central-003";
      
      // Check for S3 key credentials or alternate B2 keys
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.OBJECT_STORAGE_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.OBJECT_STORAGE_APPLICATION_KEY;
      const bucket = process.env.B2_BUCKET_QUARANTINE || "v0-local-quarantine";

      if (!accessKeyId || !secretAccessKey || !endpoint) {
        throw new Error(
          `S3/B2 storage provider selected (${storageProvider}) but missing environment configuration credentials.`
        );
      }

      console.log(`[STORAGE API] Generating presigned URL for key: ${objectKey} in bucket: ${bucket} using S3/B2 provider...`);

      const s3Client = new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        },
        forcePathStyle: true, // Required for Backblaze B2 and similar S3-compatible APIs
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      });

      // Generate a presigned URL valid for 1 hour
      uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    } else {
      // Local development fallback: direct browser to local API simulator
      console.log(`[STORAGE API] Using local-filesystem provider fallback for key: ${objectKey}`);
      uploadUrl = `${req.nextUrl.origin}/api/storage/upload?key=${objectKey}`;
    }

    // Update the job input in database with the correct final objectKey
    const currentInput = (job.input || {}) as any;
    const updatedInput = {
      ...currentInput,
      video_object_key: objectKey,
    };

    await prisma.job.update({
      where: { id: job_id },
      data: {
        input: updatedInput,
      },
    });

    console.log(`[STORAGE API SUCCESS] Generated uploadUrl successfully for job ${job_id}`);

    return NextResponse.json({ uploadUrl, objectKey });
  } catch (error: any) {
    console.error("[STORAGE API ERROR] Failed to generate upload URL:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL", details: error.message },
      { status: 500 }
    );
  }
}
