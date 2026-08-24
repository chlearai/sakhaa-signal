import { S3Client } from "@aws-sdk/client-s3";

const REQUIRED_B2_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ENDPOINT_URL",
  "AWS_DEFAULT_REGION",
] as const;

export function isB2Configured(): boolean {
  return REQUIRED_B2_ENV.every((name: string) => Boolean(process.env[name]));
}

export function getB2Client(): S3Client {
  const missing = REQUIRED_B2_ENV.filter((name: string) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Backblaze B2 is not configured. Missing: ${missing.join(", ")}`);
  }

  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION!,
    endpoint: process.env.AWS_ENDPOINT_URL!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function getQuarantineBucket(): string {
  const bucket = process.env.B2_BUCKET_QUARANTINE;
  if (!bucket) throw new Error("B2_BUCKET_QUARANTINE is not configured");
  return bucket;
}

export function getPrivateArtifactsBucket(): string {
  const bucket = process.env.B2_BUCKET_PRIVATE_ARTIFACTS;
  if (!bucket) throw new Error("B2_BUCKET_PRIVATE_ARTIFACTS is not configured");
  return bucket;
}
