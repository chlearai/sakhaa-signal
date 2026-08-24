import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import prisma from "@/lib/db";
import { getAuthenticatedSession } from "@/lib/auth";
import { withUserDatabaseContext } from "@/lib/db-context";
import { getB2Client, getQuarantineBucket, isB2Configured } from "@/lib/b2";
import { validateUploadMetadata } from "@/lib/uploadSanitizer";

export async function POST(req: NextRequest) {
  try {
    const { user, workspace: ws, sessionError } = await getAuthenticatedSession();
    if (!user) {
      const authServiceUnavailable =
        sessionError === "AUTH_CONFIGURATION_ERROR" ||
        sessionError === "AUTH_PROVIDER_UNAVAILABLE";
      return NextResponse.json(
        {
          error: authServiceUnavailable
            ? "Authentication service is temporarily unavailable"
            : "Unauthorized",
          code: sessionError || "AUTH_SESSION_INVALID",
        },
        { status: authServiceUnavailable ? 503 : 401 },
      );
    }

    if (!ws) {
      return NextResponse.json(
        {
          error: "Workspace could not be resolved",
          code: "WORKSPACE_RESOLUTION_FAILED",
        },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { fileName, contentType, byteSize, mediaType } = body;

    if (!fileName || !contentType || !byteSize || !mediaType) {
      return NextResponse.json(
        { error: "Missing required upload parameters: fileName, contentType, byteSize, mediaType" },
        { status: 400 }
      );
    }

    const sizeInBytes = Number(byteSize);
    if (isNaN(sizeInBytes) || sizeInBytes <= 0) {
      return NextResponse.json({ error: "Invalid upload payload size" }, { status: 400 });
    }

    const normalizedMediaType = String(mediaType).toUpperCase();
    if (normalizedMediaType !== "IMAGE" && normalizedMediaType !== "VIDEO") {
      return NextResponse.json({ error: "mediaType must be image or video" }, { status: 400 });
    }
    const validation = validateUploadMetadata(
      String(fileName),
      String(contentType),
      sizeInBytes,
      normalizedMediaType
    );
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const artifactId = crypto.randomUUID();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `workspaces/${ws.id}/analyses/${artifactId}/${sanitizedFileName}`;

    try {
      await withUserDatabaseContext(user.id, ws.id, (tx) => tx.artifact.create({
        data: {
          id: artifactId,
          workspaceId: ws.id,
          fileName: sanitizedFileName,
          contentType,
          byteSize: Number(byteSize),
          sha256: "0".repeat(64),
          status: "QUARANTINED",
          retentionClass: "ANALYSIS_INPUT",
          producer: "USER_UPLOAD",
          schemaVersion: "v1",
          objectKey,
        },
      }));
    } catch (error) {
      console.error("[PRESIGN_ARTIFACT_PERSISTENCE_ERROR]", error);
      return NextResponse.json(
        { error: "Upload could not be initialized", code: "ARTIFACT_PERSISTENCE_FAILED" },
        { status: 503 },
      );
    }

    let uploadUrl: string;
    if (isB2Configured()) {
      uploadUrl = await getSignedUrl(
        getB2Client(),
        new PutObjectCommand({
          Bucket: getQuarantineBucket(),
          Key: objectKey,
          ContentType: String(contentType),
        }),
        { expiresIn: 15 * 60 }
      );
    } else if (process.env.NODE_ENV !== "production") {
      uploadUrl = `/api/uploads/direct?key=${encodeURIComponent(objectKey)}&artifactId=${artifactId}`;
    } else {
      try {
        await prisma.artifact.delete({ where: { id: artifactId } });
      } catch {}
      return NextResponse.json({ error: "Backblaze B2 is not configured" }, { status: 503 });
    }

    return NextResponse.json({
      uploadUrl,
      artifactId,
      objectKey,
      workspaceId: ws.id,
      expiresInSeconds: 15 * 60,
    });
  } catch (error) {
    console.error("[PRESIGN_UPLOAD_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL", code: "PRESIGN_UPLOAD_FAILED" },
      { status: 500 }
    );
  }
}
