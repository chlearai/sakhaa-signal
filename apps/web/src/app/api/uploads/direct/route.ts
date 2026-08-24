import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/db";
import { getAuthenticatedSession } from "@/lib/auth";
import {
  MAX_UPLOAD_SIZE_BYTES,
  resolvePathSafely,
  validateMediaMagicBytes,
  calculateSha256,
} from "@/lib/storageUtils";

export async function PUT(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Upload proxy is disabled in production" }, { status: 404 });
  }

  try {
    const { user, workspace: ws } = await getAuthenticatedSession();
    if (!user || !ws) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const objectKey = searchParams.get("key");
    const artifactId = searchParams.get("artifactId");

    if (!objectKey) {
      return NextResponse.json({ error: "Missing required query parameter: key" }, { status: 400 });
    }

    const parts = objectKey.split("/");
    if (parts.length >= 2 && (parts[0] === "uploads" || parts[0] === "exports")) {
      const jobId = parts[1];
      const job = await prisma.job.findUnique({
        where: { id: jobId },
      });
      if (job && job.workspaceId !== ws.id && !user.isPlatformAdmin) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Upload payload (${(contentLength / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 500MB` },
        { status: 413 }
      );
    }

    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: "Uploaded file payload is empty (0 bytes)" }, { status: 400 });
    }

    if (buffer.byteLength > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File payload size (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed limit of 500MB` },
        { status: 413 }
      );
    }

    // 1. Content Security Validation: Verify real file format magic bytes
    const magicValidation = validateMediaMagicBytes(buffer);
    if (!magicValidation.isValid) {
      if (artifactId) {
        try {
          await prisma.artifact.update({
            where: { id: artifactId },
            data: { status: "REJECTED" },
          });
        } catch (e) {}
      }
      return NextResponse.json(
        { error: "Security validation failed: Invalid or unrecognized media file header" },
        { status: 400 }
      );
    }

    // 2. Cryptographic Integrity: Compute real SHA-256 hash
    const realSha256 = calculateSha256(buffer);

    const provider = process.env.OBJECT_STORAGE_PROVIDER || "local-filesystem";
    let uploadedToS3 = false;

    if ((provider === "b2" || provider === "s3") && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const s3Client = new S3Client({
          region: process.env.AWS_DEFAULT_REGION || process.env.OBJECT_STORAGE_REGION || "eu-central-003",
          endpoint: process.env.AWS_ENDPOINT_URL || process.env.OBJECT_STORAGE_ENDPOINT,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.OBJECT_STORAGE_KEY_ID || "",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.OBJECT_STORAGE_APPLICATION_KEY || "",
          },
          forcePathStyle: true,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        });

        // Use quarantine bucket dockerize-sakhaa-forge-quarantine
        const quarantineBucket = process.env.B2_BUCKET_QUARANTINE || "dockerize-sakhaa-forge-quarantine";
        const command = new PutObjectCommand({
          Bucket: quarantineBucket,
          Key: objectKey,
          ContentType: contentType,
          Body: buffer,
        });

        await s3Client.send(command);
        uploadedToS3 = true;
        console.log(`[UPLOAD_PROXY_S3] Successfully uploaded ${buffer.byteLength} bytes to quarantine bucket (${quarantineBucket}) key: ${objectKey}`);
      } catch (err: any) {
        console.warn(`[UPLOAD_PROXY_WARNING] S3/B2 upload failed (${err.message}). Saving to local quarantine storage simulator fallback...`);
      }
    }

    // This route is development-only, so local storage is an acceptable fallback.
    if (!uploadedToS3) {
      // Local development fallback: write to local storage simulator only when offline/dev
      const storageRoots = [
        path.resolve(process.cwd(), ".local", "storage", "v0-local-quarantine"),
        path.resolve(process.cwd(), "..", "..", ".local", "storage", "v0-local-quarantine"),
      ];

      for (const storageRoot of storageRoots) {
        const filePath = resolvePathSafely(storageRoot, objectKey);
        if (filePath) {
          try {
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, buffer);
          } catch (e) {
            console.warn(`[LOCAL_FALLBACK_WARN] Local storage simulator write failed: ${(e as Error).message}`);
          }
        }
      }
    }

    // 3. Update DB Artifact record with real SHA-256 hash and verified CLEAN status
    if (artifactId) {
      try {
        await prisma.artifact.update({
          where: { id: artifactId },
          data: {
            status: "CLEAN",
            byteSize: buffer.byteLength,
            sha256: realSha256,
          },
        });
      } catch (e) {}
    }

    return NextResponse.json({
      success: true,
      objectKey,
      byteSize: buffer.byteLength,
      sha256: realSha256,
      detectedType: magicValidation.detectedType,
      storage: uploadedToS3 ? "S3/B2_QUARANTINE" : "LOCAL_QUARANTINE_SIMULATOR",
    });
  } catch (error: any) {
    console.error("[UPLOAD_PROXY_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to upload file via direct upload proxy", details: error.message },
      { status: 500 }
    );
  }
}
