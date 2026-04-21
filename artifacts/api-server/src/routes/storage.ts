import { Router, type IRouter } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { db } from "@workspace/db";
import { crewProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Collect all GCS-backed file URLs stored on a crew profile.
 *
 * Only scalar fields that are written exclusively by server-side code are
 * included here (set during registration or profile photo upload — the crew
 * member never supplies a raw URL; the server generates it after uploading
 * the file to GCS). User-controlled fields such as portfolioPhotos
 * (base64 data URIs written by the client) and shift-claim attendance
 * photos (also client-supplied base64) are intentionally excluded so that
 * the ownership check cannot be bypassed by injecting an arbitrary URL.
 */
function getProfileUrls(profile: {
  closeUpPhotoUrl: string | null;
  fullLengthPhotoUrl: string | null;
  aadhaarCardUrl: string | null;
  collegeIdUrl: string | null;
  panCardUrl: string | null;
  introVideoUrl: string | null;
}): Set<string> {
  const urls = new Set<string>();
  for (const u of [
    profile.closeUpPhotoUrl,
    profile.fullLengthPhotoUrl,
    profile.aadhaarCardUrl,
    profile.collegeIdUrl,
    profile.panCardUrl,
    profile.introVideoUrl,
  ]) {
    if (u) urls.add(u);
  }
  return urls;
}

/**
 * GET /storage/objects/*
 *
 * Serve uploaded files stored in GCS.
 * Access rules:
 *   - Unauthenticated → 401
 *   - Admin           → allowed (all files)
 *   - Crew member     → allowed only if the URL is one of the server-assigned
 *                       GCS URLs on their own crew profile (closeUpPhotoUrl,
 *                       fullLengthPhotoUrl, aadhaarCardUrl, collegeIdUrl,
 *                       panCardUrl, introVideoUrl).  Ownership is based
 *                       solely on immutable server-written relations.
 */
router.get("/storage/objects/*path", async (req, res) => {
  const session = (req as any).session;

  if (!session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
  const requestedUrl = `/api/storage/objects/${wildcardPath}`;

  if (session.role !== "admin") {
    const [profile] = await db
      .select({
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        fullLengthPhotoUrl: crewProfilesTable.fullLengthPhotoUrl,
        aadhaarCardUrl: crewProfilesTable.aadhaarCardUrl,
        collegeIdUrl: crewProfilesTable.collegeIdUrl,
        panCardUrl: crewProfilesTable.panCardUrl,
        introVideoUrl: crewProfilesTable.introVideoUrl,
      })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.userId, session.userId));

    if (!profile) {
      return res.status(403).json({ error: "Access denied" });
    }

    const profileUrls = getProfileUrls(profile);
    if (!profileUrls.has(requestedUrl)) {
      return res.status(403).json({ error: "Access denied" });
    }
  }

  try {
    const objectPath = `/objects/${wildcardPath}`;

    let response: Response;

    if (objectPath.startsWith("/objects/db/")) {
      const fileId = parseInt(objectPath.slice("/objects/db/".length), 10);
      if (isNaN(fileId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      response = await objectStorageService.downloadFromDb(fileId);
    } else {
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      response = await objectStorageService.downloadObject(objectFile);
    }

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("[storage] Error serving object:", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
