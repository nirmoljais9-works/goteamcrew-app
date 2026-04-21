import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, crewProfilesTable, referralsTable, eventsTable, shiftsTable, shiftClaimsTable } from "@workspace/db";
import { eq, or, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

const objectStorage = new ObjectStorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === "application/pdf";
    if (ext && mime) cb(null, true);
    else cb(new Error("Only images and PDFs allowed"));
  },
});

const registerUpload = upload.fields([
  { name: "aadhaarCard", maxCount: 1 },
  { name: "collegeId", maxCount: 1 },
  { name: "closeUpPhoto", maxCount: 1 },
  { name: "fullLengthPhoto", maxCount: 1 },
]);

async function uploadFileToStorage(file: Express.Multer.File): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  console.log("[uploadFileToStorage/auth] file:", file.originalname, "mime:", file.mimetype, "ext:", ext, "size:", file.size);
  return objectStorage.uploadBuffer(file.buffer, file.mimetype, ext);
}

// ── Public: event gender requirement (used in referral registration validation) ──
router.get("/auth/event-gender/:eventId", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
    const [ev] = await db
      .select({ genderRequired: eventsTable.genderRequired })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    if (!ev) return res.status(404).json({ error: "Event not found" });
    res.json({ genderRequired: ev.genderRequired || null });
  } catch (err) {
    console.error("[event-gender]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Check if phone/email already exists (used for real-time duplicate detection) ──
router.get("/auth/check-exists", async (req, res) => {
  try {
    const { phone, email } = req.query as { phone?: string; email?: string };
    if (!phone && !email) return res.status(400).json({ error: "Phone or email required" });

    if (phone) {
      // Normalise: strip spaces, then strip leading +91 or 91 to get bare 10-digit number
      const stripped = phone.replace(/\s/g, "");
      let bare = stripped;
      if (bare.startsWith("+91")) bare = bare.slice(3);
      else if (bare.startsWith("91") && bare.length === 12) bare = bare.slice(2);

      // Match both "9999055547" and "+919999055547" storage formats
      const [byPhone] = await db
        .select({ status: usersTable.status, crewProfileId: crewProfilesTable.id })
        .from(crewProfilesTable)
        .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
        .where(or(
          eq(crewProfilesTable.phone, bare),
          eq(crewProfilesTable.phone, `+91${bare}`),
        ));
      if (byPhone && byPhone.status !== "removed") {
        const canPrefill = byPhone.status === "rejected" || byPhone.status === "resubmitted";
        return res.json({
          exists: true,
          status: byPhone.status,
          ...(canPrefill ? { crewProfileId: byPhone.crewProfileId } : {}),
        });
      }
    }

    if (email) {
      const [byEmail] = await db
        .select({ status: usersTable.status, crewProfileId: crewProfilesTable.id })
        .from(usersTable)
        .leftJoin(crewProfilesTable, eq(crewProfilesTable.userId, usersTable.id))
        .where(eq(usersTable.email, email.toLowerCase().trim()));
      if (byEmail && byEmail.status !== "removed") {
        const canPrefill = byEmail.status === "rejected" || byEmail.status === "resubmitted";
        return res.json({
          exists: true,
          status: byEmail.status,
          ...(canPrefill && byEmail.crewProfileId ? { crewProfileId: byEmail.crewProfileId } : {}),
        });
      }
    }

    return res.json({ exists: false });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/auth/me", (req, res) => {
  const session = (req as any).session;
  if (!session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    status: usersTable.status,
    createdAt: usersTable.createdAt,
    rejectionReason: crewProfilesTable.rejectionReason,
    crewProfileId: crewProfilesTable.id,
  })
  .from(usersTable)
  .leftJoin(crewProfilesTable, eq(crewProfilesTable.userId, usersTable.id))
  .where(eq(usersTable.id, session.userId))
  .then(([row]) => {
    if (!row) return res.status(401).json({ error: "User not found" });
    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      rejectionReason: row.rejectionReason ?? null,
      crewProfileId: row.crewProfileId ?? null,
    });
  }).catch(() => res.status(500).json({ error: "Server error" }));
});

router.post("/auth/login", async (req, res) => {
  try {
    // Accept either `phone` (crew) or `email` (admin fallback) in the same field
    const { phone, email, password } = req.body;
    const identifier = (phone || email || "").trim();
    if (!identifier || !password) return res.status(400).json({ error: "Phone number and password are required" });

    let user: typeof usersTable.$inferSelect | undefined;

    // 1. Phone lookup — normalise and query via crew_profiles
    const digits = identifier.replace(/\D/g, "");
    let phoneBare = digits;
    if (phoneBare.startsWith("91") && phoneBare.length === 12) phoneBare = phoneBare.slice(2);
    phoneBare = phoneBare.slice(-10);

    if (phoneBare.length === 10) {
      const [profile] = await db
        .select({ userId: crewProfilesTable.userId })
        .from(crewProfilesTable)
        .where(or(
          eq(crewProfilesTable.phone, phoneBare),
          eq(crewProfilesTable.phone, `+91${phoneBare}`),
        ));
      if (profile) {
        const rows = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
        user = rows[0];
      }
    }

    // 2. Email fallback — covers admins and edge cases
    if (!user) {
      const rows = await db.select().from(usersTable).where(eq(usersTable.email, identifier.toLowerCase()));
      user = rows[0];
    }

    if (!user) return res.status(401).json({ error: "Invalid phone number or password" });

    // Block removed accounts before password check
    if (user.role === "crew" && user.status === "removed") {
      return res.status(403).json({ error: "Your account has been removed by admin. Please contact support for assistance.", code: "REMOVED" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid phone number or password" });

    (req as any).session.userId = user.id;
    (req as any).session.role = user.role;

    // Fetch crew profile extras (rejection reason, profile id) for crew users
    let rejectionReason: string | null = null;
    let crewProfileId: number | null = null;
    if (user.role === "crew") {
      const [profile] = await db
        .select({ id: crewProfilesTable.id, rejectionReason: crewProfilesTable.rejectionReason })
        .from(crewProfilesTable)
        .where(eq(crewProfilesTable.userId, user.id));
      if (profile) {
        rejectionReason = profile.rejectionReason ?? null;
        crewProfileId = profile.id;
      }
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      rejectionReason,
      crewProfileId,
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/register", (req, res) => {
  registerUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const {
        email, password, name, phone, city, age, gender,
        category, customRole, experienceLevel, languages, height, instagramUrl,
        referrerId, referralEventId,
        referralSource, referralOther,
        idType, dob,
      } = req.body;

      if (!password || String(password).trim().length === 0) {
        return res.status(400).json({ error: "Password is required. Please go back to Step 1 and set a password." });
      }

      if (!name || !phone || !email || !city || !age || !gender || !category || !experienceLevel || !languages) {
        return res.status(400).json({ error: "Please fill in all required fields" });
      }

      if (!["Male", "Female"].includes(gender)) {
        return res.status(400).json({ error: "Gender must be Male or Female" });
      }

      // ── Server-side: validate date of birth ──────────────────────────────────
      if (dob) {
        // Expect ISO format YYYY-MM-DD from frontend
        const dobDate = new Date(dob);
        const isValidDate =
          !isNaN(dobDate.getTime()) &&
          /^\d{4}-\d{2}-\d{2}$/.test(dob) &&
          (() => {
            const [yyyy, mm, dd] = dob.split("-").map(Number);
            const currentYear = new Date().getFullYear();
            if (yyyy < 1940 || yyyy > currentYear) return false;
            if (mm < 1 || mm > 12) return false;
            if (dd < 1 || dd > 31) return false;
            // Rollover check — rejects 31 Feb, 31 Apr, etc.
            return (
              dobDate.getFullYear() === yyyy &&
              dobDate.getMonth() + 1 === mm &&
              dobDate.getDate() === dd
            );
          })();
        if (!isValidDate || dobDate >= new Date()) {
          return res.status(400).json({ error: "Please enter a valid date of birth", code: "INVALID_DOB" });
        }
        // Minimum age: 15 years
        const today = new Date();
        const [yyyy, mm, dd] = dob.split("-").map(Number);
        let age = today.getFullYear() - yyyy;
        if (today.getMonth() + 1 < mm || (today.getMonth() + 1 === mm && today.getDate() < dd)) age--;
        if (age < 15) {
          return res.status(400).json({ error: "You must be at least 15 years old to register", code: "UNDERAGE" });
        }
      }

      // ── Server-side: validate gender against referral event requirement ──────
      if (referralEventId) {
        const evtId = parseInt(referralEventId);
        if (!isNaN(evtId)) {
          const [refEvent] = await db
            .select({ genderRequired: eventsTable.genderRequired })
            .from(eventsTable)
            .where(eq(eventsTable.id, evtId));
          if (refEvent?.genderRequired) {
            const req = refEvent.genderRequired.toLowerCase();
            if (req !== "any" && req !== "both") {
              if (gender.toLowerCase() !== req) {
                return res.status(403).json({
                  error: `This event is only open for ${refEvent.genderRequired} candidates. Your gender (${gender}) does not match.`,
                  code: "GENDER_MISMATCH",
                });
              }
            }
          }
        }
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files?.closeUpPhoto?.[0]) {
        return res.status(400).json({ error: "Selfie photo is required" });
      }

      if (!files?.aadhaarCard?.[0]) {
        return res.status(400).json({ error: "ID document upload is required" });
      }

      const emailLower = email.toLowerCase().trim();
      const phoneTrimmed = phone.trim();

      // ── Upload files to cloud storage before any DB operations ────────────
      const isCollegeId = (idType || "").toLowerCase().includes("college");
      const [idFileUrl, closeUpUrl, fullLengthUrl] = await Promise.all([
        uploadFileToStorage(files.aadhaarCard[0]),
        uploadFileToStorage(files.closeUpPhoto[0]),
        files?.fullLengthPhoto?.[0] ? uploadFileToStorage(files.fullLengthPhoto[0]) : Promise.resolve(null),
      ]);
      const aadhaarUrl = isCollegeId ? null : idFileUrl;
      const collegeIdUrl = isCollegeId ? idFileUrl : null;

      // Normalise phone: strip non-digits, remove leading 91, take last 10 digits
      const phoneStripped = phoneTrimmed.replace(/\D/g, "");
      let phoneBare = phoneStripped;
      if (phoneBare.startsWith("91") && phoneBare.length === 12) phoneBare = phoneBare.slice(2);
      phoneBare = phoneBare.slice(-10);

      // ── 1 + 2. Look up phone AND email in parallel ────────────────────────
      const [[existingProfile], [existingByEmail]] = await Promise.all([
        db
          .select({
            profileId: crewProfilesTable.id,
            userId: crewProfilesTable.userId,
            status: usersTable.status,
            userEmail: usersTable.email,
          })
          .from(crewProfilesTable)
          .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
          .where(or(
            eq(crewProfilesTable.phone, phoneBare),
            eq(crewProfilesTable.phone, `+91${phoneBare}`),
          )),
        db
          .select({ id: usersTable.id, status: usersTable.status })
          .from(usersTable)
          .where(eq(usersTable.email, emailLower)),
      ]);

      if (existingProfile) {
        const { status, userId, profileId, userEmail } = existingProfile;

        // Blacklisted: hard block
        if (status === "blacklisted") {
          return res.status(403).json({
            error: "You are not allowed to register on this platform.",
            code: "BLACKLISTED",
          });
        }

        // Approved / Active: already a member
        if (status === "approved" || status === "active") {
          return res.status(409).json({
            error: "You are already registered. Please log in.",
            code: "ALREADY_REGISTERED",
          });
        }

        // Rejected or Pending: allow reapplication
        // If email is changing, make sure new email isn't taken by a DIFFERENT user
        if (emailLower !== userEmail) {
          const [takenEmail] = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.email, emailLower));
          if (takenEmail && takenEmail.id !== userId) {
            return res.status(400).json({ error: "That email address is already registered to another account." });
          }
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Update user record — use "resubmitted" so admin can see it's an update after rejection
        const [updatedUser] = await db
          .update(usersTable)
          .set({
            email: emailLower,
            passwordHash,
            name: name.trim(),
            status: "resubmitted",
          })
          .where(eq(usersTable.id, userId))
          .returning();

        // Update crew profile — always use new files
        await db
          .update(crewProfilesTable)
          .set({
            city: city.trim(),
            age: parseInt(age) || null,
            gender,
            category,
            customRole: customRole?.trim() || null,
            experienceLevel,
            languages: languages.trim(),
            height: height?.trim() || null,
            instagramUrl: instagramUrl?.trim() || null,
            idType: idType?.trim() || null,
            aadhaarCardUrl: aadhaarUrl,
            collegeIdUrl: collegeIdUrl,
            closeUpPhotoUrl: closeUpUrl,
            fullLengthPhotoUrl: fullLengthUrl,
            blacklistReason: null,
            rejectionReason: null,
          })
          .where(eq(crewProfilesTable.id, profileId));

        (req as any).session.userId = updatedUser.id;
        (req as any).session.role = updatedUser.role;
        return res.status(200).json({
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
          status: updatedUser.status,
          createdAt: updatedUser.createdAt,
          reapplied: true,
        });
      }

      // ── 2. No profile by phone — check the email result from parallel query ─
      if (existingByEmail) {
        const { status } = existingByEmail;
        if (status === "blacklisted") {
          return res.status(403).json({
            error: "You are not allowed to register on this platform.",
            code: "BLACKLISTED",
          });
        }
        if (status === "approved" || status === "active") {
          return res.status(409).json({
            error: "You are already registered. Please log in.",
            code: "ALREADY_REGISTERED",
          });
        }
        // pending/rejected with no crew profile — treat as duplicate email
        return res.status(400).json({
          error: "This email is already registered. Please use your phone number to reapply.",
          code: "EMAIL_EXISTS",
        });
      }

      // ── 3. Completely new registration ─────────────────────────────────────
      const passwordHash = await bcrypt.hash(password, 10);
      const [user] = await db.insert(usersTable).values({
        email: emailLower,
        passwordHash,
        name: name.trim(),
        role: "crew",
        status: "pending",
      }).returning();

      const heardAboutUsValue = referralSource === "Other"
        ? (referralOther?.trim() || "Other")
        : (referralSource?.trim() || null);

      console.log("[register] referralSource:", referralSource, "| referralOther:", referralOther, "| heardAboutUs:", heardAboutUsValue);

      const [newCrewProfile] = await db.insert(crewProfilesTable).values({
        userId: user.id,
        phone: phoneTrimmed,
        city: city.trim(),
        age: parseInt(age) || null,
        gender,
        category,
        customRole: customRole?.trim() || null,
        experienceLevel,
        languages: languages.trim(),
        height: height?.trim() || null,
        instagramUrl: instagramUrl?.trim() || null,
        idType: idType?.trim() || null,
        aadhaarCardUrl: aadhaarUrl,
        collegeIdUrl: collegeIdUrl,
        closeUpPhotoUrl: closeUpUrl,
        fullLengthPhotoUrl: fullLengthUrl,
        heardAboutUs: heardAboutUsValue,
      }).returning({ id: crewProfilesTable.id });

      // ── Set session and respond immediately — don't wait for referral ────────
      (req as any).session.userId = user.id;
      (req as any).session.role = user.role;
      res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        reapplied: false,
      });

      // ── Link referral in background (fire-and-forget) ──────────────────────
      if (referrerId && referralEventId) {
        setImmediate(async () => {
          try {
            const refId = parseInt(referrerId);
            const evtId = parseInt(referralEventId);
            console.log(`[register] Referral params: referrerId=${refId}, eventId=${evtId}, newUserId=${user.id}`);

            if (!isNaN(refId) && !isNaN(evtId)) {
              const [existingReferral] = await db.select().from(referralsTable)
                .where(and(eq(referralsTable.referrerId, refId), eq(referralsTable.eventId, evtId)));

              if (existingReferral && !existingReferral.referredUserId) {
                await db.update(referralsTable)
                  .set({ referredUserId: user.id, status: "joined", updatedAt: new Date() })
                  .where(eq(referralsTable.id, existingReferral.id));
                await db.update(crewProfilesTable)
                  .set({ totalReferrals: sql`${crewProfilesTable.totalReferrals} + 1`, updatedAt: new Date() })
                  .where(eq(crewProfilesTable.id, refId));
                console.log(`[register] Linked existing referral id=${existingReferral.id} to user=${user.id}`);
              } else {
                const [event] = await db.select({ referralReward: eventsTable.referralReward })
                  .from(eventsTable).where(eq(eventsTable.id, evtId));
                const referralCode = `${refId}-${evtId}-${user.id}`;
                await db.insert(referralsTable).values({
                  eventId: evtId,
                  referrerId: refId,
                  referredUserId: user.id,
                  referralCode,
                  status: "joined",
                  rewardAmount: event?.referralReward || null,
                });
                await db.update(crewProfilesTable)
                  .set({ totalReferrals: sql`${crewProfilesTable.totalReferrals} + 1`, updatedAt: new Date() })
                  .where(eq(crewProfilesTable.id, refId));
                console.log(`[register] Created new referral for user=${user.id}, referrer=${refId}, event=${evtId}`);
              }

              // ── Auto-create shift claim ──────────────────────────────────
              if (newCrewProfile?.id) {
                try {
                  const [defaultShift] = await db
                    .select({ id: shiftsTable.id })
                    .from(shiftsTable)
                    .where(eq(shiftsTable.eventId, evtId))
                    .limit(1);

                  if (defaultShift) {
                    const [existingClaim] = await db
                      .select({ id: shiftClaimsTable.id })
                      .from(shiftClaimsTable)
                      .where(and(
                        eq(shiftClaimsTable.shiftId, defaultShift.id),
                        eq(shiftClaimsTable.crewId, newCrewProfile.id),
                      ));

                    if (!existingClaim) {
                      await db.insert(shiftClaimsTable).values({
                        shiftId: defaultShift.id,
                        crewId: newCrewProfile.id,
                        status: "pending",
                      });
                      console.log(`[register] Auto-created shift claim for crewProfile=${newCrewProfile.id}, shift=${defaultShift.id}, event=${evtId}`);
                    }
                  }
                } catch (claimErr) {
                  console.error("[register] Failed to auto-create shift claim:", claimErr);
                }
              }
            }
          } catch (refErr) {
            console.error("[register] Failed to link referral:", refErr);
          }
        });
      }
    } catch (dbErr: any) {
      console.error("[register] Error:", dbErr?.message ?? dbErr);
      if (dbErr?.constraint === "crew_phone_unique") {
        return res.status(400).json({ error: "Phone number already registered" });
      }
      res.status(500).json({
        error: "Server error during registration",
        detail: dbErr?.message ?? String(dbErr),
      });
    }
  });
});

// ── Crew profile prefill for resubmission (public — by crew_id, limited fields) ─
router.get("/auth/crew-profile/:crewId", async (req, res) => {
  try {
    const crewId = parseInt(req.params.crewId);
    if (isNaN(crewId)) return res.status(400).json({ error: "Invalid crew_id" });
    const [row] = await db
      .select({
        id: crewProfilesTable.id,
        name: usersTable.name,
        email: usersTable.email,
        status: usersTable.status,
        phone: crewProfilesTable.phone,
        city: crewProfilesTable.city,
        age: crewProfilesTable.age,
        gender: crewProfilesTable.gender,
        category: crewProfilesTable.category,
        customRole: crewProfilesTable.customRole,
        experienceLevel: crewProfilesTable.experienceLevel,
        languages: crewProfilesTable.languages,
        height: crewProfilesTable.height,
        instagramUrl: crewProfilesTable.instagramUrl,
        rejectionReason: crewProfilesTable.rejectionReason,
        aadhaarCardUrl: crewProfilesTable.aadhaarCardUrl,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId))
      .where(eq(crewProfilesTable.id, crewId));
    if (!row) return res.status(404).json({ error: "Not found" });
    // Only expose for rejected/resubmitted status — not for active/approved users
    if (row.status !== "rejected" && row.status !== "resubmitted") return res.status(403).json({ error: "Profile not available for editing" });
    res.json(row);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/logout", (req, res) => {
  (req as any).session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
