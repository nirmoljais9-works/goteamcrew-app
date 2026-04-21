import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, crewProfilesTable, shiftClaimsTable, shiftsTable, eventsTable, paymentsTable, attendanceBreaksTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { computeCheckInStatus, computeCheckOutStatus, getISTDate } from "../lib/attendance-utils";
import { ObjectStorageService } from "../lib/objectStorage";
import multer from "multer";
import path from "path";
let sharpModule: any = null;
(async () => { try { sharpModule = (await import("sharp")).default; } catch { sharpModule = null; } })();

const objectStorage = new ObjectStorageService();

const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === "application/pdf";
    if (ext && mime) cb(null, true);
    else cb(new Error("Only images and PDFs allowed"));
  },
}).fields([{ name: "panCard", maxCount: 1 }]);

// Portfolio photo upload — memory storage, server-side resize via sharp
const portfolioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("photo");

// Intro video upload — memory storage, 20 MB limit, MP4/MOV only
const introVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /mp4|mov|m4v|quicktime/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase().replace(".", ""));
    const mime = /video\/(mp4|quicktime|x-m4v)/.test(file.mimetype);
    if (ext || mime) cb(null, true);
    else cb(new Error("Only MP4 and MOV videos are allowed"));
  },
}).single("video");

async function uploadFileToStorage(file: Express.Multer.File): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  console.log("[uploadFileToStorage/crew] file:", file.originalname, "mime:", file.mimetype, "ext:", ext, "size:", file.size);
  return objectStorage.uploadBuffer(file.buffer, file.mimetype, ext);
}

/**
 * Returns true when a photoUrl value looks like a server-controlled storage URL
 * (either the /api/storage/ proxy path or a direct GCS public URL).
 * Used to reject storage URLs as attendance selfies — those must be live camera base64.
 */
function isStorageUrl(photoUrl: string | null | undefined): boolean {
  if (!photoUrl) return false;
  const normalized = photoUrl.trim().toLowerCase();
  return normalized.includes("/api/storage/") || normalized.startsWith("https://storage.googleapis.com/");
}

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

async function requireNotBlacklisted(req: any, res: any, next: any) {
  try {
    const [user] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user?.status === "blacklisted") {
      return res.status(403).json({ error: "Your account has been suspended.", code: "BLACKLISTED" });
    }
    next();
  } catch {
    res.status(500).json({ error: "Server error" });
  }
}

function buildProfileResponse(user: any, profile: any) {
  return {
    id: profile.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: profile.phone,
    city: profile.city,
    age: profile.age,
    gender: profile.gender,
    category: profile.category,
    experienceLevel: profile.experienceLevel,
    languages: profile.languages,
    height: profile.height,
    instagramUrl: profile.instagramUrl,
    closeUpPhotoUrl: profile.closeUpPhotoUrl,
    fullLengthPhotoUrl: profile.fullLengthPhotoUrl,
    aadhaarCardUrl: profile.aadhaarCardUrl,
    collegeIdUrl: profile.collegeIdUrl,
    skills: profile.skills,
    experience: profile.experience,
    payHolderName: profile.payHolderName,
    payBankName: profile.payBankName,
    payBranchName: profile.payBranchName,
    payAccountNumber: profile.payAccountNumber,
    payIfscCode: profile.payIfscCode,
    payUpiId: profile.payUpiId,
    panNumber: profile.panNumber,
    panCardUrl: profile.panCardUrl,
    portfolioPhotos: profile.portfolioPhotos || null,
    photoQuality: profile.photoQuality || null,
    introVideoUrl: profile.introVideoUrl || null,
    introVideoQuality: profile.introVideoQuality || null,
    source: profile.heardAboutUs || null,
    status: user.status,
    totalEarnings: parseFloat(profile.totalEarnings || "0"),
    completedShifts: profile.completedShifts,
    createdAt: user.createdAt,
  };
}

// ── Portfolio image upload ──────────────────────────────────────────────────────
// Accepts a raw photo, resizes with sharp, uploads to GCS (or DB fallback),
// and returns { dataUrl } where dataUrl is a GCS URL or /api/storage/... path.
router.post("/crew/portfolio/upload-photo", requireAuth, (req: any, res: any) => {
  portfolioUpload(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ error: "No file received" });

    try {
      let buffer: Buffer;
      if (sharpModule) {
        buffer = await sharpModule(req.file.buffer)
          .rotate()
          .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75, progressive: true })
          .toBuffer();
      } else {
        buffer = req.file.buffer;
      }

      // Upload to GCS (or DB fallback) — uploadBuffer() returns a ready-to-use URL
      const dataUrl = await objectStorage.uploadBuffer(buffer, "image/jpeg", ".jpg");
      console.log("[portfolio-upload] stored at:", dataUrl);
      res.json({ dataUrl });
    } catch (e: any) {
      console.error("[portfolio-upload] error:", e?.message);
      res.status(500).json({ error: "Image processing failed on server" });
    }
  });
});

// ── Intro video upload ─────────────────────────────────────────────────────────
router.post("/crew/portfolio/upload-video", requireAuth, (req: any, res: any) => {
  introVideoUpload(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ error: "No file received" });
    try {
      console.log("[video-upload] Uploading via GCS/DB storage, size:", req.file.size);
      const videoUrl = await uploadFileToStorage(req.file);
      console.log("[video-upload] Stored at:", videoUrl);
      await db.update(crewProfilesTable)
        .set({ introVideoUrl: videoUrl, updatedAt: new Date() })
        .where(eq(crewProfilesTable.userId, req.session.userId));
      res.json({ videoUrl });
    } catch (e: any) {
      console.error("[video-upload] error:", e?.message);
      res.status(500).json({ error: "Failed to save video" });
    }
  });
});

// ── Delete intro video ─────────────────────────────────────────────────────────
router.delete("/crew/portfolio/delete-video", requireAuth, async (req: any, res: any) => {
  try {
    const [profile] = await db.select({ introVideoUrl: crewProfilesTable.introVideoUrl })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.userId, req.session.userId));

    if (profile?.introVideoUrl) {
      const url = profile.introVideoUrl;
      try {
        if (url.includes("/api/storage/objects/")) {
          // Legacy internal proxy path
          const objectPath = url.replace(/^.*\/api\/storage/, "");
          await objectStorage.deleteObject(objectPath);
        } else if (url.startsWith("https://storage.googleapis.com/")) {
          // Public GCS URL — normalize to internal object path then delete
          const objectPath = objectStorage.normalizeObjectEntityPath(url);
          await objectStorage.deleteObject(objectPath);
        }
      } catch (e: any) {
        console.error("[video-delete] storage delete error:", e?.message);
      }
    }

    await db.update(crewProfilesTable)
      .set({ introVideoUrl: null, updatedAt: new Date() })
      .where(eq(crewProfilesTable.userId, req.session.userId));

    res.json({ success: true });
  } catch (e: any) {
    console.error("[video-delete] error:", e?.message);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

router.get("/crew/profile", requireAuth, async (req: any, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    res.json(buildProfileResponse(user, profile));
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/crew/profile", requireAuth, (req: any, res: any) => {
  profileUpload(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const {
        payHolderName, payBankName, payBranchName, payAccountNumber, payIfscCode, payUpiId, panNumber,
        name, city, languages, experience, category,
        portfolioPhotos, photoQuality, instagramUrl,
      } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const panCardFile = files?.panCard?.[0];
      const panCardUrl = panCardFile ? await uploadFileToStorage(panCardFile) : undefined;

      // All fields save directly — no pending/approval flow
      await db.update(crewProfilesTable).set({
        ...(payHolderName !== undefined && { payHolderName }),
        ...(payBankName !== undefined && { payBankName }),
        ...(payBranchName !== undefined && { payBranchName }),
        ...(payAccountNumber !== undefined && { payAccountNumber }),
        ...(payIfscCode !== undefined && { payIfscCode }),
        ...(payUpiId !== undefined && { payUpiId }),
        ...(panNumber !== undefined && { panNumber }),
        ...(panCardUrl && { panCardUrl }),
        ...(name !== undefined && { name }),
        ...(city !== undefined && { city }),
        ...(languages !== undefined && { languages }),
        ...(experience !== undefined && { experience }),
        ...(category !== undefined && { category }),
        ...(portfolioPhotos !== undefined && { portfolioPhotos }),
        ...(photoQuality !== undefined && { photoQuality }),
        ...(instagramUrl !== undefined && { instagramUrl }),
        updatedAt: new Date(),
      }).where(eq(crewProfilesTable.userId, req.session.userId));

      // If name was updated, also sync the users table
      if (name !== undefined) {
        await db.update(usersTable).set({ name, updatedAt: new Date() })
          .where(eq(usersTable.id, req.session.userId));
      }

      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
      const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));

      res.json(buildProfileResponse(user, profile));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  });
});

router.get("/crew/shifts", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const claims = await db
      .select({
        id: shiftClaimsTable.id,
        shiftId: shiftClaimsTable.shiftId,
        crewId: shiftClaimsTable.crewId,
        status: shiftClaimsTable.status,
        claimedAt: shiftClaimsTable.claimedAt,
        approvedAt: shiftClaimsTable.approvedAt,
        shiftRole: shiftsTable.role,
        shiftStartTime: shiftsTable.startTime,
        shiftEndTime: shiftsTable.endTime,
        totalPay: shiftsTable.totalPay,
        eventTitle: eventsTable.title,
        eventLocation: eventsTable.location,
        eventCity: eventsTable.city,
        eventStartDate: eventsTable.startDate,
        eventEndDate: eventsTable.endDate,
        eventPayPerDay: eventsTable.payPerDay,
        eventPayFemale: eventsTable.payFemale,
        eventPayMale: eventsTable.payMale,
        eventPayFresher: eventsTable.payFresher,
        eventFoodProvided: eventsTable.foodProvided,
        eventMealsProvided: eventsTable.mealsProvided,
        eventDressCode: eventsTable.dressCode,
        eventLatitude: eventsTable.latitude,
        eventLongitude: eventsTable.longitude,
        eventExpectedCheckIn: eventsTable.expectedCheckIn,
        eventExpectedCheckOut: eventsTable.expectedCheckOut,
        crewName: usersTable.name,
        crewEmail: usersTable.email,
        checkedInAt: shiftClaimsTable.checkedInAt,
        attendanceDate: shiftClaimsTable.attendanceDate,
        checkInStatus: shiftClaimsTable.checkInStatus,
        checkOutAt: shiftClaimsTable.checkOutAt,
        checkOutStatus: shiftClaimsTable.checkOutStatus,
        isAbsent: shiftClaimsTable.isAbsent,
        breakStartAt: shiftClaimsTable.breakStartAt,
        breakEndAt: shiftClaimsTable.breakEndAt,
        totalBreakMinutes: shiftClaimsTable.totalBreakMinutes,
        attendanceApproved: shiftClaimsTable.attendanceApproved,
        approvedPay: shiftClaimsTable.approvedPay,
        isOverride: shiftClaimsTable.isOverride,
        overrideReason: shiftClaimsTable.overrideReason,
      })
      .from(shiftClaimsTable)
      .innerJoin(shiftsTable, eq(shiftClaimsTable.shiftId, shiftsTable.id))
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .innerJoin(usersTable, eq(usersTable.id, req.session.userId))
      .where(eq(shiftClaimsTable.crewId, profile.id))
      .orderBy(shiftClaimsTable.claimedAt);

    const result = claims.map(c => {
      const start = c.eventStartDate ? new Date(c.eventStartDate) : null;
      const end = c.eventEndDate ? new Date(c.eventEndDate) : null;
      // Compare IST calendar dates (UTC+5:30) so a same-day shift like 3PM–9PM
      // counts as 1 day rather than 2.
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const days = start && end
        ? (() => {
          const startDay = Math.floor((start.getTime() + IST_OFFSET_MS) / 86400000);
          const endDay   = Math.floor((end.getTime()   + IST_OFFSET_MS) / 86400000);
          return Math.max(1, endDay - startDay + 1);
        })()
        : 1;
      const payPerDay = parseFloat(c.eventPayPerDay || "0");
      const computedTotalPay = payPerDay > 0 ? payPerDay * days : parseFloat(c.totalPay || "0");
      console.log(`[crew/shifts] claim=${c.id} event="${c.eventTitle}" eventLatitude=${c.eventLatitude ?? "NULL"} eventLongitude=${c.eventLongitude ?? "NULL"}`);

      // Always compute status dynamically from stored times — never rely on the
      // cached DB value so that admin time-edits are reflected immediately.
      const dynamicCheckInStatus  = computeCheckInStatus(c.checkedInAt,  c.eventExpectedCheckIn,  c.eventStartDate);
      const dynamicCheckOutStatus = computeCheckOutStatus(c.checkOutAt, c.eventExpectedCheckOut, c.eventStartDate);

      return {
        ...c,
        crewPhone: "",
        totalPay: computedTotalPay,
        eventDays: days,
        eventPayPerDay: payPerDay,
        checkInStatus:  dynamicCheckInStatus,
        checkOutStatus: dynamicCheckOutStatus,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Attendance ────────────────────────────────────────────────────────────────

async function getClaimForCrew(claimId: number, userId: number) {
  const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, userId));
  if (!profile) return null;
  const [claim] = await db.select().from(shiftClaimsTable).where(
    and(eq(shiftClaimsTable.id, claimId), eq(shiftClaimsTable.crewId, profile.id))
  );
  return claim || null;
}

function isTimeInWindow(now: Date, windowStart: string | null, windowEnd: string | null): boolean {
  if (!windowStart || !windowEnd) return true;
  const pad = (t: string) => t.padStart(5, "0");
  const [sh, sm] = pad(windowStart).split(":").map(Number);
  const [eh, em] = pad(windowEnd).split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  return nowMins >= startMins && nowMins <= endMins;
}

router.post("/crew/attendance/:claimId/checkin", requireAuth, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.claimId);
    const claim = await getClaimForCrew(claimId, req.session.userId);
    if (!claim) return res.status(404).json({ error: "Shift not found" });
    if (claim.status !== "approved") return res.status(400).json({ error: "Shift not approved" });
    if (claim.checkedInAt) return res.status(400).json({ error: "Already checked in" });
    if (claim.isAbsent) return res.status(400).json({ error: "Marked absent" });

    const { lat, lng, photoUrl, distanceFromEvent } = req.body as { lat?: string; lng?: string; photoUrl?: string; distanceFromEvent?: number };

    if (isStorageUrl(photoUrl)) {
      return res.status(400).json({ error: "Invalid photo format" });
    }

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));

    const now = new Date();

    // Compute status dynamically: "late" if actual check-in is after the
    // event's expected check-in time (full 24-hour IST datetime comparison).
    const checkInStatus = computeCheckInStatus(now, event.expectedCheckIn, event.startDate) ?? "on-time";

    const attendanceDate = getISTDate(now);

    await db.update(shiftClaimsTable)
      .set({
        checkedInAt: now,
        attendanceDate,
        checkInStatus,
        isAbsent: false,
        checkInLat: lat || null,
        checkInLng: lng || null,
        selfieImage: photoUrl || null,
        distanceFromEvent: distanceFromEvent != null ? String(distanceFromEvent) : null,
        updatedAt: new Date(),
      })
      .where(eq(shiftClaimsTable.id, claimId));

    const expectedDT = event.expectedCheckIn ?? "–";
    console.log(`[attendance] Check-in claim ${claimId}: ${checkInStatus} (expectedCheckIn=${expectedDT}) attendanceDate=${attendanceDate}`);
    res.json({ success: true, checkInStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/crew/attendance/:claimId/break-start", requireAuth, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.claimId);
    const claim = await getClaimForCrew(claimId, req.session.userId);
    if (!claim) return res.status(404).json({ error: "Shift not found" });
    if (!claim.checkedInAt) return res.status(400).json({ error: "Not checked in yet" });
    if (claim.checkOutAt) return res.status(400).json({ error: "Already checked out" });
    if (claim.breakStartAt && !claim.breakEndAt) return res.status(400).json({ error: "Break already started" });

    const { lat, lng, photoUrl, distanceFromEvent: dfe1 } = req.body as { lat?: string; lng?: string; photoUrl?: string; distanceFromEvent?: number };

    if (isStorageUrl(photoUrl)) {
      return res.status(400).json({ error: "Invalid photo format" });
    }

    const now = new Date();

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));
    const inWindow = isTimeInWindow(now, event.breakWindowStart, event.breakWindowEnd);

    await db.insert(attendanceBreaksTable).values({
      claimId,
      startAt: now,
      isOutsideWindow: !inWindow,
      lat: lat || null,
      lng: lng || null,
      photoUrl: photoUrl || null,
    });

    await db.update(shiftClaimsTable)
      .set({ breakStartAt: now, breakEndAt: null, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[attendance] Break start: claim ${claimId}, inWindow=${inWindow}`);
    res.json({ success: true, isOutsideWindow: !inWindow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/crew/attendance/:claimId/break-end", requireAuth, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.claimId);
    const claim = await getClaimForCrew(claimId, req.session.userId);
    if (!claim) return res.status(404).json({ error: "Shift not found" });
    if (!claim.breakStartAt) return res.status(400).json({ error: "Break not started" });
    if (claim.breakEndAt) return res.status(400).json({ error: "Break already ended" });

    const now = new Date();
    const breakMins = Math.round((now.getTime() - new Date(claim.breakStartAt).getTime()) / 60000);
    const total = (claim.totalBreakMinutes || 0) + breakMins;

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));
    const breakExceeded = event.allowedBreakMinutes != null && total > event.allowedBreakMinutes;

    const openBreaks = await db.select().from(attendanceBreaksTable)
      .where(and(eq(attendanceBreaksTable.claimId, claimId)));
    const currentBreak = openBreaks.find(b => !b.endAt);
    if (currentBreak) {
      await db.update(attendanceBreaksTable)
        .set({ endAt: now, durationMinutes: breakMins })
        .where(eq(attendanceBreaksTable.id, currentBreak.id));
    }

    await db.update(shiftClaimsTable)
      .set({ breakEndAt: now, totalBreakMinutes: total, breakExceeded, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[attendance] Break end: claim ${claimId}, break ${breakMins}m, total ${total}m, exceeded=${breakExceeded}`);
    res.json({ success: true, breakMinutes: breakMins, totalBreakMinutes: total, breakExceeded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/crew/attendance/:claimId/checkout", requireAuth, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.claimId);
    const claim = await getClaimForCrew(claimId, req.session.userId);
    if (!claim) return res.status(404).json({ error: "Shift not found" });
    if (!claim.checkedInAt) return res.status(400).json({ error: "Not checked in yet" });
    if (claim.checkOutAt) return res.status(400).json({ error: "Already checked out" });
    if (claim.breakStartAt && !claim.breakEndAt) return res.status(400).json({ error: "End your break before checking out" });

    const { lat, lng, photoUrl, distanceFromEvent: dfe2 } = req.body as { lat?: string; lng?: string; photoUrl?: string; distanceFromEvent?: number };

    if (isStorageUrl(photoUrl)) {
      return res.status(400).json({ error: "Invalid photo format" });
    }

    const [shift2] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event2] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift2.eventId));

    const now = new Date();
    const checkOutStatus = computeCheckOutStatus(now, event2.expectedCheckOut, event2.startDate);

    await db.update(shiftClaimsTable)
      .set({
        checkOutAt: now,
        checkOutStatus: checkOutStatus ?? null,
        checkOutLat: lat || null,
        checkOutLng: lng || null,
        checkOutPhotoUrl: photoUrl || null,
        updatedAt: new Date(),
      })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[attendance] Check-out: claim ${claimId}, checkOutStatus=${checkOutStatus ?? "on-time"}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/crew/attendance/:claimId/breaks", requireAuth, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.claimId);
    const claim = await getClaimForCrew(claimId, req.session.userId);
    if (!claim) return res.status(404).json({ error: "Shift not found" });
    const breaks = await db.select().from(attendanceBreaksTable)
      .where(eq(attendanceBreaksTable.claimId, claimId));
    res.json(breaks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/crew/earnings", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const payments = await db
      .select({
        id: paymentsTable.id,
        crewId: paymentsTable.crewId,
        shiftClaimId: paymentsTable.shiftClaimId,
        amount: paymentsTable.amount,
        status: paymentsTable.status,
        paymentMethod: paymentsTable.paymentMethod,
        reference: paymentsTable.reference,
        notes: paymentsTable.notes,
        paidAt: paymentsTable.paidAt,
        createdAt: paymentsTable.createdAt,
        crewName: usersTable.name,
        // shift claim fields
        approvedPay: shiftClaimsTable.approvedPay,
        isOverride: shiftClaimsTable.isOverride,
        overrideReason: shiftClaimsTable.overrideReason,
        checkedInAt: shiftClaimsTable.checkedInAt,
        checkOutAt: shiftClaimsTable.checkOutAt,
        checkInStatus: shiftClaimsTable.checkInStatus,
        checkOutStatus: shiftClaimsTable.checkOutStatus,
        totalBreakMinutes: shiftClaimsTable.totalBreakMinutes,
        // shift fields
        shiftRole: shiftsTable.role,
        totalPay: shiftsTable.totalPay,
        // event fields
        eventTitle: eventsTable.title,
        eventStartDate: eventsTable.startDate,
        eventCity: eventsTable.city,
        eventExpectedCheckIn: eventsTable.expectedCheckIn,
        eventExpectedCheckOut: eventsTable.expectedCheckOut,
        eventLateThreshold: eventsTable.lateThresholdMinutes,
        eventPayPerDay: eventsTable.payPerDay,
        eventLatitude: eventsTable.latitude,
        eventLongitude: eventsTable.longitude,
        // selfies & GPS
        selfieImage: shiftClaimsTable.selfieImage,
        checkOutPhotoUrl: shiftClaimsTable.checkOutPhotoUrl,
        checkInLat: shiftClaimsTable.checkInLat,
        checkInLng: shiftClaimsTable.checkInLng,
        checkOutLat: shiftClaimsTable.checkOutLat,
        checkOutLng: shiftClaimsTable.checkOutLng,
        distanceFromEvent: shiftClaimsTable.distanceFromEvent,
      })
      .from(paymentsTable)
      .innerJoin(usersTable, eq(usersTable.id, req.session.userId))
      .leftJoin(shiftClaimsTable, eq(paymentsTable.shiftClaimId, shiftClaimsTable.id))
      .leftJoin(shiftsTable, eq(shiftClaimsTable.shiftId, shiftsTable.id))
      .leftJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .where(eq(paymentsTable.crewId, profile.id))
      .orderBy(desc(paymentsTable.createdAt));

    // totalPaid = only money actually received (status = "paid")
    const totalPaid = payments.filter(p => p.status === "paid")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    // pendingPayments = finalized by admin but not yet paid out
    const pendingPayments = payments.filter(p => p.status === "pending" || p.status === "processing")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    // keep paidPayments for backward compat
    const paidPayments = totalPaid;

    const approvedClaims = await db
      .select()
      .from(shiftClaimsTable)
      .where(and(eq(shiftClaimsTable.crewId, profile.id), eq(shiftClaimsTable.status, "approved")));
    const pendingClaims = await db
      .select()
      .from(shiftClaimsTable)
      .where(and(eq(shiftClaimsTable.crewId, profile.id), eq(shiftClaimsTable.status, "pending")));

    res.json({
      totalEarnings: totalPaid,   // backward compat alias
      totalPaid,
      pendingPayments,
      paidPayments,
      completedShifts: profile.completedShifts,
      upcomingShifts: approvedClaims.length + pendingClaims.length,
      payments: payments.map(p => ({
        ...p,
        amount: parseFloat(p.amount || "0"),
        approvedPay: p.approvedPay != null ? parseFloat(p.approvedPay) : null,
        totalPay: p.totalPay != null ? parseFloat(p.totalPay) : null,
        eventPayPerDay: p.eventPayPerDay != null ? parseFloat(p.eventPayPerDay) : null,
        totalBreakMinutes: p.totalBreakMinutes ?? 0,
      })),
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
