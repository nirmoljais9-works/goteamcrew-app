import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { uploadedFilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const DEFAULT_BUCKET = "goteamcrew-files";

function createStorageClient(): Storage | null {
  // Priority 1: GOOGLE_APPLICATION_CREDENTIALS (file path set in env)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("[storage] GOOGLE_APPLICATION_CREDENTIALS detected —", process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log("[storage] Initializing GCS with file credentials");
    return new Storage();
  }

  // Priority 2: GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY (inline JSON, legacy)
  if (process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY) {
    console.log("[storage] GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY detected — using GCS service account");
    try {
      const rawKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;
      const cleanedKey = rawKey
        .trim()
        .replace(/^\\/, "")
        .replace(/\\"/g, '"');
      console.log("[storage] cleanedKey preview:", cleanedKey.substring(0, 50));
      const credentials = JSON.parse(cleanedKey);
      console.log("[storage] GCS credentials parsed successfully, project:", credentials.project_id);
      return new Storage({ credentials, projectId: credentials.project_id });
    } catch (e) {
      console.error("[storage] Failed to parse GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY:", e);
      console.error("[storage] Falling back to next available method");
    }
  } else {
    console.warn("[storage] GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY is NOT set");
  }

  // Priority 3: Replit sidecar
  if (process.env.REPL_ID) {
    console.log("[storage] REPL_ID detected — using Replit sidecar for GCS auth");
    return new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
  }

  // Fallback: database blob storage
  console.warn("[storage] No GCS credentials and no REPL_ID — using database blob storage fallback");
  return null;
}

export const objectStorageClient = createStorageClient();

/**
 * Convert a stored photo URL to a proxy-served path that the browser can load.
 *
 * When running in Replit, files are stored in a *private* GCS bucket
 * (PRIVATE_OBJECT_DIR = /replit-objstore-xxx/.private).  The bucket is NOT
 * publicly accessible, so a direct https://storage.googleapis.com/... URL
 * will fail in the browser.  This function converts those URLs to the
 * authenticated /api/storage/objects/... proxy route that the Express server
 * can serve using the Replit sidecar credentials.
 *
 * On the production VPS (GOOGLE_APPLICATION_CREDENTIALS set), PRIVATE_OBJECT_DIR
 * is undefined and photos are either in a public GCS bucket (return as-is) or
 * already stored as /api/storage/... paths (also returned as-is).
 */
export function normalizePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Already a proxy path — nothing to do
  if (url.startsWith("/api/storage/")) return url;
  // Direct GCS URL — check if it points to the private Replit bucket
  if (url.startsWith("https://storage.googleapis.com/")) {
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateDir) return url; // production with public bucket — serve directly
    const dirPath = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
    const slashIdx = dirPath.indexOf("/");
    const bucket = slashIdx > 0 ? dirPath.slice(0, slashIdx) : dirPath;
    const objectDirPrefix = slashIdx > 0 ? dirPath.slice(slashIdx + 1) + "/" : "";
    const gcsPrefix = `https://storage.googleapis.com/${bucket}/${objectDirPrefix}`;
    if (url.startsWith(gcsPrefix)) {
      const entityId = url.slice(gcsPrefix.length);
      return `/api/storage/objects/${entityId}`;
    }
  }
  return url;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

const DB_OBJECT_PREFIX = "/objects/db/";

export class ObjectStorageService {
  constructor() {}

  /**
   * Upload a buffer to GCS (if configured) or the database as a fallback.
   *
   * GCS path:  returns full public URL — https://storage.googleapis.com/{bucket}/uploads/{uuid}.ext
   * DB fallback: returns internal path — /objects/db/{id}
   */
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    extension: string = ""
  ): Promise<string> {
    console.log("uploadBuffer called");
    console.log("Checking GCS condition:", process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log("[uploadBuffer] objectStorageClient:", objectStorageClient ? "INITIALIZED" : "NULL");
    console.log("[uploadBuffer] buffer size:", buffer.length, "contentType:", contentType, "ext:", extension);

    // ── Path 1: GOOGLE_APPLICATION_CREDENTIALS — force GCS unconditionally ──
    // Accepts either a file path ("/path/to/key.json") OR raw JSON content ("{...}")
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("GCS upload function triggered");
      try {
        let gcsClient: Storage;
        const credValue = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
        if (credValue.startsWith("{")) {
          console.log("[uploadBuffer] GOOGLE_APPLICATION_CREDENTIALS contains JSON — parsing inline");
          const credentials = JSON.parse(credValue);
          gcsClient = new Storage({ credentials, projectId: credentials.project_id });
        } else {
          console.log("[uploadBuffer] GOOGLE_APPLICATION_CREDENTIALS is a file path:", credValue);
          gcsClient = new Storage(); // picks up env var automatically
        }
        const bucketName = DEFAULT_BUCKET;
        const objectId = randomUUID();
        const fileName = extension ? `${objectId}${extension}` : objectId;
        const objectName = `uploads/${fileName}`;
        console.log("[uploadBuffer] GCS bucket:", bucketName, "object:", objectName);
        const bucket = gcsClient.bucket(bucketName);
        const file = bucket.file(objectName);
        console.log("[uploadBuffer] calling file.save()...");
        await file.save(buffer, { contentType, resumable: false });
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
        console.log("[uploadBuffer] GCS upload SUCCESS:", publicUrl);
        return publicUrl;
      } catch (gcsErr: any) {
        console.error("[uploadBuffer] GCS upload FAILED — code:", gcsErr?.code, "message:", gcsErr?.message);
        console.error("[uploadBuffer] Full GCS error:", JSON.stringify(gcsErr, null, 2));
        console.warn("[uploadBuffer] Falling back to database storage");
        // Fall through to DB fallback
      }
    }

    // ── Path 2: Replit sidecar or other pre-initialized client ──
    if (objectStorageClient && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const privateObjectDir = this.getPrivateObjectDir();
      const objectId = randomUUID();
      const fileName = extension ? `${objectId}${extension}` : objectId;
      const fullPath = `${privateObjectDir}/uploads/${fileName}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      console.log("[uploadBuffer] sidecar GCS — bucket:", bucketName, "object:", objectName);
      try {
        const bucket = objectStorageClient.bucket(bucketName);
        const file = bucket.file(objectName);
        await file.save(buffer, { contentType, resumable: false });
        // Replit bucket is private — return the authenticated proxy path instead
        // of the direct GCS URL (which would 403 in the browser).
        const proxyPath = `/api/storage/objects/uploads/${fileName}`;
        console.log("[uploadBuffer] sidecar GCS upload SUCCESS (proxy path):", proxyPath);
        return proxyPath;
      } catch (gcsErr: any) {
        console.error("[uploadBuffer] sidecar GCS FAILED:", gcsErr?.message);
        console.warn("[uploadBuffer] Falling back to database storage");
      }
    }

    // ── Path 3: Database fallback ──
    console.log("[uploadBuffer] Inserting into database...");
    const [row] = await db
      .insert(uploadedFilesTable)
      .values({ dataB64: buffer.toString("base64"), contentType })
      .returning({ id: uploadedFilesTable.id });
    const dbUrl = `/api/storage${DB_OBJECT_PREFIX}${row.id}`;
    console.log("[uploadBuffer] DB fallback complete, URL:", dbUrl);
    return dbUrl;
  }

  /**
   * Download an uploaded file from the database by its DB path.
   * Called from the storage route when the path starts with /objects/db/.
   */
  async downloadFromDb(fileId: number): Promise<Response> {
    const [row] = await db
      .select()
      .from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.id, fileId));
    if (!row) throw new ObjectNotFoundError();
    const buf = Buffer.from(row.dataB64, "base64");
    return new Response(buf, {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  /**
   * Delete an object from GCS or the database.
   */
  async deleteObject(objectPath: string): Promise<void> {
    try {
      if (objectPath.startsWith(DB_OBJECT_PREFIX)) {
        const id = parseInt(objectPath.slice(DB_OBJECT_PREFIX.length), 10);
        if (!isNaN(id)) {
          await db.delete(uploadedFilesTable).where(eq(uploadedFilesTable.id, id));
        }
        return;
      }
      const objectFile = await this.getObjectEntityFile(objectPath);
      await objectFile.delete();
    } catch (e: any) {
      if (e instanceof ObjectNotFoundError) return;
      throw e;
    }
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (dir) return dir;
    console.log(`[storage] PRIVATE_OBJECT_DIR not set — defaulting to /${DEFAULT_BUCKET}`);
    return `/${DEFAULT_BUCKET}`;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (!objectStorageClient) return null;
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }
    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectStorageClient) {
      throw new ObjectNotFoundError();
    }
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) objectEntityDir = `${objectEntityDir}/`;
    if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return { bucketName: pathParts[1], objectName: pathParts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }
  const { signed_url: signedURL } = await response.json() as { signed_url: string };
  return signedURL;
}
