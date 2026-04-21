import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  crewProfilesTable,
  eventsTable,
  shiftsTable,
  shiftClaimsTable,
  paymentsTable,
  attendanceBreaksTable,
  referralsTable,
} from "@workspace/db";
import { computeCheckInStatus, computeCheckOutStatus, getISTDate } from "../lib/attendance-utils";
import { eq, and, count, sql, or, isNotNull, isNull, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();

/**
 * Extract all GCS-backed storage URLs from a crew profile.
 * Returns an array of object paths (e.g. "/objects/uploads/uuid.jpg")
 * suitable for passing to objectStorage.deleteObject().
 * portfolioPhotos entries are included only when they are storage URLs
 * (i.e. start with "/api/storage/") so base64 data URIs are skipped.
 */
function extractStoragePaths(profile: {
  closeUpPhotoUrl?: string | null;
  fullLengthPhotoUrl?: string | null;
  aadhaarCardUrl?: string | null;
  collegeIdUrl?: string | null;
  panCardUrl?: string | null;
  introVideoUrl?: string | null;
  portfolioPhotos?: string | null;
}): string[] {
  const API_PREFIX = "/api/storage";
  const paths: string[] = [];

  for (const url of [
    profile.closeUpPhotoUrl,
    profile.fullLengthPhotoUrl,
    profile.aadhaarCardUrl,
    profile.collegeIdUrl,
    profile.panCardUrl,
    profile.introVideoUrl,
  ]) {
    if (url && url.startsWith(API_PREFIX)) {
      paths.push(url.slice(API_PREFIX.length));
    }
  }

  if (profile.portfolioPhotos) {
    try {
      const arr: unknown = JSON.parse(profile.portfolioPhotos);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string" && item.startsWith(API_PREFIX)) {
            paths.push(item.slice(API_PREFIX.length));
          }
        }
      }
    } catch {}
  }

  return paths;
}

const router: IRouter = Router();

// Helper: update referral status when a claim is approved/rejected by admin.
// Approval moves referral to "selected" (interim — attended not confirmed yet).
// Rejection/revocation moves it back to "joined".
// successfulReferrals counter and wallet reward are ONLY updated at attendance-approval time.
async function syncReferralOnClaimChange(crewProfileId: number, eventId: number, newClaimStatus: string) {
  try {
    const [profile] = await db.select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable).where(eq(crewProfilesTable.id, crewProfileId));
    if (!profile) return;

    const [referral] = await db.select()
      .from(referralsTable)
      .where(and(eq(referralsTable.referredUserId, profile.userId), eq(referralsTable.eventId, eventId)));
    if (!referral) return;

    let newReferralStatus: string | null = null;

    if (newClaimStatus === "approved" && (referral.status === "pending" || referral.status === "joined")) {
      newReferralStatus = "selected";
    } else if ((newClaimStatus === "rejected" || newClaimStatus === "revoked") && referral.status === "selected") {
      newReferralStatus = "joined";
    }

    if (newReferralStatus) {
      await db.update(referralsTable)
        .set({ status: newReferralStatus as any, updatedAt: new Date() })
        .where(eq(referralsTable.id, referral.id));
    }
  } catch (err) {
    console.error("[referral sync] error:", err);
  }
}

// Helper: move referral to "pending_approval" when attendance is approved.
// Wallet credit only happens when admin explicitly marks as paid.
async function syncReferralOnAttendanceApproval(crewId: number, eventId: number) {
  try {
    const [profile] = await db.select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return;

    const [referral] = await db.select()
      .from(referralsTable)
      .where(and(eq(referralsTable.referredUserId, profile.userId), eq(referralsTable.eventId, eventId)));

    if (!referral) return;
    // Skip if already past pending_approval stage
    if (["pending_approval", "successful", "confirmed", "paid"].includes(referral.status as string)) return;

    await db.update(referralsTable)
      .set({ status: "pending_approval" as any, updatedAt: new Date() })
      .where(eq(referralsTable.id, referral.id));

    console.log(`[referral] Moved referral id=${referral.id} to pending_approval after attendance approved`);
  } catch (err) {
    console.error("[referral attendance sync] error:", err);
  }
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// ─── Crew List ────────────────────────────────────────────────────────────────
router.get("/admin/crew", requireAdmin, async (req: any, res) => {
  try {
    const { search, city, category, status } = req.query;

    let crew = await db
      .select({
        id: crewProfilesTable.id,
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
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
        blacklistReason: crewProfilesTable.blacklistReason,
        rejectionReason: crewProfilesTable.rejectionReason,
        aadhaarCardUrl: crewProfilesTable.aadhaarCardUrl,
        collegeIdUrl: crewProfilesTable.collegeIdUrl,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        fullLengthPhotoUrl: crewProfilesTable.fullLengthPhotoUrl,
        skills: crewProfilesTable.skills,
        experience: crewProfilesTable.experience,
        payHolderName: crewProfilesTable.payHolderName,
        payBankName: crewProfilesTable.payBankName,
        payBranchName: crewProfilesTable.payBranchName,
        payAccountNumber: crewProfilesTable.payAccountNumber,
        payIfscCode: crewProfilesTable.payIfscCode,
        payUpiId: crewProfilesTable.payUpiId,
        panNumber: crewProfilesTable.panNumber,
        panCardUrl: crewProfilesTable.panCardUrl,
        source: crewProfilesTable.heardAboutUs,
        status: usersTable.status,
        totalEarnings: crewProfilesTable.totalEarnings,
        completedShifts: crewProfilesTable.completedShifts,
        createdAt: usersTable.createdAt,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId));

    if (search) {
      const s = (search as string).toLowerCase();
      crew = crew.filter(c =>
        c.name.toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        c.phone.includes(s)
      );
    }
    if (city) {
      crew = crew.filter(c => c.city?.toLowerCase() === (city as string).toLowerCase());
    }
    if (category) {
      crew = crew.filter(c => c.category?.toLowerCase().includes((category as string).toLowerCase()));
    }
    if (status && status !== "all") {
      crew = crew.filter(c => c.status === status);
    }

    // Build "Referred By" + "Referred Event" maps
    const referredByMap: Record<number, string> = {};
    const referredEventMap: Record<number, string> = {};
    const allUserIds = crew.map(c => c.userId).filter((id): id is number => id != null);
    if (allUserIds.length > 0) {
      const refRows = await db
        .select({
          referredUserId: referralsTable.referredUserId,
          referrerId: referralsTable.referrerId,
          eventId: referralsTable.eventId,
        })
        .from(referralsTable)
        .where(inArray(referralsTable.referredUserId, allUserIds));

      if (refRows.length > 0) {
        const referrerIds = [...new Set(refRows.map(r => r.referrerId).filter((id): id is number => id != null))];
        const referrers = await db
          .select({ id: crewProfilesTable.id, name: usersTable.name })
          .from(crewProfilesTable)
          .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
          .where(inArray(crewProfilesTable.id, referrerIds));

        const referrerNameMap: Record<number, string> = {};
        for (const r of referrers) referrerNameMap[r.id] = r.name;

        // Fetch event titles for the referred events
        const eventIds = [...new Set(refRows.map(r => r.eventId).filter((id): id is number => id != null))];
        const events = eventIds.length > 0
          ? await db.select({ id: eventsTable.id, title: eventsTable.title }).from(eventsTable).where(inArray(eventsTable.id, eventIds))
          : [];
        const eventTitleMap: Record<number, string> = {};
        for (const ev of events) eventTitleMap[ev.id] = ev.title;

        for (const row of refRows) {
          if (row.referredUserId && row.referrerId && !referredByMap[row.referredUserId]) {
            referredByMap[row.referredUserId] = referrerNameMap[row.referrerId] || "Unknown";
            if (row.eventId) referredEventMap[row.referredUserId] = eventTitleMap[row.eventId] || "";
          }
        }
      }
    }

    res.json(crew.map(c => ({
      ...c,
      totalEarnings: parseFloat(c.totalEarnings || "0"),
      referredByName: referredByMap[c.userId] || null,
      referredEventName: referredEventMap[c.userId] || null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Export CSV (must be before /:id route) ──────────────────────────────────
router.get("/admin/crew/export", requireAdmin, async (req: any, res) => {
  try {
    const crew = await db
      .select({
        id: crewProfilesTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: crewProfilesTable.phone,
        city: crewProfilesTable.city,
        age: crewProfilesTable.age,
        gender: crewProfilesTable.gender,
        category: crewProfilesTable.category,
        experienceLevel: crewProfilesTable.experienceLevel,
        languages: crewProfilesTable.languages,
        height: crewProfilesTable.height,
        instagramUrl: crewProfilesTable.instagramUrl,
        status: usersTable.status,
        createdAt: usersTable.createdAt,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId));

    const headers = ["ID", "Name", "Email", "Phone", "City", "Age", "Gender", "Category", "Experience Level", "Languages", "Height", "Instagram", "Status", "Registered At"];
    const rows = crew.map(c => [
      c.id, c.name, c.email, c.phone, c.city || "", c.age || "",
      c.gender || "", c.category || "", c.experienceLevel || "",
      c.languages || "", c.height || "", c.instagramUrl || "",
      c.status, new Date(c.createdAt).toLocaleDateString("en-IN"),
    ]);

    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="goteam-crew-${Date.now()}.csv"`);
    res.send(csv);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Referral Context (must be before /:id) ───────────────────────────────────
router.get("/admin/referral-context", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.query.crewId as string);
    if (isNaN(crewId)) return res.status(400).json({ error: "crewId required" });

    const [profile] = await db
      .select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.id, crewId));

    if (!profile) return res.status(404).json({ error: "Not found" });

    const [referral] = await db
      .select({
        id: referralsTable.id,
        eventId: referralsTable.eventId,
        referrerId: referralsTable.referrerId,
        status: referralsTable.status,
        rewardAmount: referralsTable.rewardAmount,
        createdAt: referralsTable.createdAt,
        eventTitle: eventsTable.title,
        eventCity: eventsTable.city,
        eventLocation: eventsTable.location,
        eventStartDate: eventsTable.startDate,
        eventEndDate: eventsTable.endDate,
      })
      .from(referralsTable)
      .innerJoin(eventsTable, eq(referralsTable.eventId, eventsTable.id))
      .where(eq(referralsTable.referredUserId, profile.userId));

    if (!referral) return res.status(404).json({ error: "No referral found" });

    const [referrer] = await db
      .select({
        id: crewProfilesTable.id,
        name: usersTable.name,
        category: crewProfilesTable.category,
        customRole: crewProfilesTable.customRole,
        city: crewProfilesTable.city,
        experienceLevel: crewProfilesTable.experienceLevel,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        totalReferrals: crewProfilesTable.totalReferrals,
        successfulReferrals: crewProfilesTable.successfulReferrals,
        completedShifts: crewProfilesTable.completedShifts,
        totalEarnings: crewProfilesTable.totalEarnings,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
      .where(eq(crewProfilesTable.id, referral.referrerId));

    // Compute referral stats for the referrer
    let referralStats = { total: 0, registered: 0, selected: 0, confirmed: 0, rejected: 0 };
    if (referrer) {
      const allReferrals = await db
        .select({ referredUserId: referralsTable.referredUserId, status: referralsTable.status })
        .from(referralsTable)
        .where(eq(referralsTable.referrerId, referrer.id));
      referralStats.total = allReferrals.filter(r => r.referredUserId != null).length;
      referralStats.registered = allReferrals.filter(r => r.referredUserId != null).length;
      referralStats.selected = allReferrals.filter(r => r.status === "selected").length;
      referralStats.confirmed = allReferrals.filter(r => r.status === "confirmed").length;
      referralStats.rejected = allReferrals.filter(r => r.status === "rejected").length;
    }

    const [shift] = referral.eventId
      ? await db
          .select({ role: shiftsTable.role })
          .from(shiftsTable)
          .where(eq(shiftsTable.eventId, referral.eventId))
          .limit(1)
      : [];

    res.json({
      referral: {
        id: referral.id,
        status: referral.status,
        rewardAmount: referral.rewardAmount,
        createdAt: referral.createdAt,
      },
      event: {
        id: referral.eventId,
        title: referral.eventTitle,
        city: referral.eventCity,
        location: referral.eventLocation,
        startDate: referral.eventStartDate,
        endDate: referral.eventEndDate,
        role: shift?.role || null,
      },
      referrer: referrer ? { ...referrer, totalEarnings: parseFloat(referrer.totalEarnings || "0"), stats: referralStats } : null,
    });
  } catch (err) {
    console.error("[referral-context]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Referral Stats for a Crew Member (as referrer) ─────────────────────────
router.get("/admin/crew/:id/referral-stats", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    if (isNaN(crewId)) return res.status(400).json({ error: "Invalid id" });

    const allReferrals = await db
      .select({ referredUserId: referralsTable.referredUserId, status: referralsTable.status })
      .from(referralsTable)
      .where(eq(referralsTable.referrerId, crewId));

    const registered = allReferrals.filter(r => r.referredUserId != null).length;
    const selected   = allReferrals.filter(r => r.status === "selected").length;
    const confirmed  = allReferrals.filter(r => r.status === "confirmed").length;
    const rejected   = allReferrals.filter(r => r.status === "rejected").length;
    const successRate = registered > 0 ? Math.round(((selected + confirmed) / registered) * 100) : 0;

    res.json({ registered, selected, confirmed, rejected, successRate });
  } catch (err) {
    console.error("[referral-stats]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Single Crew Member ───────────────────────────────────────────────────────
router.get("/admin/crew/:id", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const [profile] = await db
      .select({
        id: crewProfilesTable.id,
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: crewProfilesTable.phone,
        city: crewProfilesTable.city,
        age: crewProfilesTable.age,
        gender: crewProfilesTable.gender,
        category: crewProfilesTable.category,
        experienceLevel: crewProfilesTable.experienceLevel,
        languages: crewProfilesTable.languages,
        height: crewProfilesTable.height,
        instagramUrl: crewProfilesTable.instagramUrl,
        blacklistReason: crewProfilesTable.blacklistReason,
        rejectionReason: crewProfilesTable.rejectionReason,
        aadhaarCardUrl: crewProfilesTable.aadhaarCardUrl,
        collegeIdUrl: crewProfilesTable.collegeIdUrl,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        fullLengthPhotoUrl: crewProfilesTable.fullLengthPhotoUrl,
        skills: crewProfilesTable.skills,
        experience: crewProfilesTable.experience,
        bankAccount: crewProfilesTable.bankAccount,
        payHolderName: crewProfilesTable.payHolderName,
        payBankName: crewProfilesTable.payBankName,
        payBranchName: crewProfilesTable.payBranchName,
        payAccountNumber: crewProfilesTable.payAccountNumber,
        payIfscCode: crewProfilesTable.payIfscCode,
        payUpiId: crewProfilesTable.payUpiId,
        panNumber: crewProfilesTable.panNumber,
        panCardUrl: crewProfilesTable.panCardUrl,
        idType: crewProfilesTable.idType,
        source: crewProfilesTable.heardAboutUs,
        status: usersTable.status,
        totalEarnings: crewProfilesTable.totalEarnings,
        completedShifts: crewProfilesTable.completedShifts,
        createdAt: usersTable.createdAt,
        portfolioPhotos: crewProfilesTable.portfolioPhotos,
        photoQuality: crewProfilesTable.photoQuality,
        introVideoUrl: crewProfilesTable.introVideoUrl,
        introVideoQuality: crewProfilesTable.introVideoQuality,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId))
      .where(eq(crewProfilesTable.id, crewId));

    if (!profile) return res.status(404).json({ error: "Crew member not found" });

    console.log(`[admin/crew/${crewId}] source:`, profile.source);
    res.json({ ...profile, totalEarnings: parseFloat(profile.totalEarnings || "0") });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Update source (how they heard about us) ──────────────────────────────────
router.patch("/admin/crew/:id/source", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const { source } = req.body;
    if (source === undefined) return res.status(400).json({ error: "source is required" });
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(crewProfilesTable)
      .set({ heardAboutUs: source || null, updatedAt: new Date() })
      .where(eq(crewProfilesTable.id, crewId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Set intro video quality ──────────────────────────────────────────────────
router.patch("/admin/crew/:id/intro-video-quality", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const { quality } = req.body;
    if (quality !== "good" && quality !== "can_be_improved" && quality !== null)
      return res.status(400).json({ error: "quality must be 'good', 'can_be_improved', or null" });
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(crewProfilesTable)
      .set({ introVideoQuality: quality, updatedAt: new Date() })
      .where(eq(crewProfilesTable.id, crewId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Approve ──────────────────────────────────────────────────────────────────
router.post("/admin/crew/:id/approve", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(usersTable).set({ status: "approved", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Set Pending (undo approval) ──────────────────────────────────────────────
router.post("/admin/crew/:id/set-pending", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(usersTable).set({ status: "pending", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Reject ───────────────────────────────────────────────────────────────────
router.post("/admin/crew/:id/reject", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const { reason } = req.body as { reason?: string };
    const [profile] = await db
      .select({ userId: crewProfilesTable.userId, id: crewProfilesTable.id })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(usersTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    await db.update(crewProfilesTable)
      .set({ rejectionReason: reason?.trim() || null })
      .where(eq(crewProfilesTable.id, crewId));
    const editLink = `https://goteamcrew.in/register?crew_id=${crewId}`;
    res.json({ success: true, editLink, rejectionReason: reason?.trim() || null });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Blacklist ────────────────────────────────────────────────────────────────
router.post("/admin/crew/:id/blacklist", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const { reason } = req.body;
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(usersTable).set({ status: "blacklisted", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    await db.update(crewProfilesTable).set({ blacklistReason: reason || null }).where(eq(crewProfilesTable.id, crewId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Remove (soft-delete) ─────────────────────────────────────────────────────
router.post("/admin/crew/:id/remove", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const { force } = req.body as { force?: boolean };
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });

    if (!force) {
      const pending = await db.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.crewId, crewId), eq(paymentsTable.status, "pending")));
      if (pending.length > 0) {
        return res.status(400).json({ error: "This crew member has pending payments. Please clear payments before removing.", code: "PENDING_PAYMENTS" });
      }
    }

    await db.update(usersTable).set({ status: "removed", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Re-activate ──────────────────────────────────────────────────────────────
router.post("/admin/crew/:id/reactivate", requireAdmin, async (req: any, res) => {
  try {
    const crewId = parseInt(req.params.id);
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });
    await db.update(usersTable).set({ status: "approved", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Set quality tag for a portfolio photo ────────────────────────────────────
router.patch("/admin/crew/:id/portfolio/:photoIndex/quality", requireAdmin, async (req: any, res) => {
  try {
    const crewId     = parseInt(req.params.id);
    const photoIndex = parseInt(req.params.photoIndex);
    const { quality } = req.body; // "good" | "rejected" | null

    if (quality !== "good" && quality !== "rejected" && quality !== null)
      return res.status(400).json({ error: "quality must be 'good', 'rejected', or null" });

    const [profile] = await db
      .select({ portfolioPhotos: crewProfilesTable.portfolioPhotos, photoQuality: crewProfilesTable.photoQuality })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.id, crewId));

    if (!profile) return res.status(404).json({ error: "Crew not found" });

    let photos: string[] = [];
    try { photos = JSON.parse(profile.portfolioPhotos || "[]"); } catch {}

    if (photoIndex < 0 || photoIndex >= photos.length)
      return res.status(400).json({ error: "Invalid photo index" });

    let qualities: (string | null)[] = [];
    try { qualities = JSON.parse(profile.photoQuality || "[]"); } catch {}

    // Pad to match photo length, then set
    while (qualities.length < photos.length) qualities.push(null);
    qualities[photoIndex] = quality;

    await db.update(crewProfilesTable)
      .set({ photoQuality: JSON.stringify(qualities), updatedAt: new Date() })
      .where(eq(crewProfilesTable.id, crewId));

    res.json({ ok: true, photoQuality: qualities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Delete a single portfolio photo ─────────────────────────────────────────
router.delete("/admin/crew/:id/portfolio/:photoIndex", requireAdmin, async (req: any, res) => {
  try {
    const crewId     = parseInt(req.params.id);
    const photoIndex = parseInt(req.params.photoIndex);

    const [profile] = await db
      .select({ portfolioPhotos: crewProfilesTable.portfolioPhotos, photoQuality: crewProfilesTable.photoQuality })
      .from(crewProfilesTable)
      .where(eq(crewProfilesTable.id, crewId));

    if (!profile) return res.status(404).json({ error: "Crew not found" });

    let photos: string[] = [];
    try { photos = JSON.parse(profile.portfolioPhotos || "[]"); } catch {}

    if (photoIndex < 0 || photoIndex >= photos.length)
      return res.status(400).json({ error: "Invalid photo index" });

    let qualities: (string | null)[] = [];
    try { qualities = JSON.parse(profile.photoQuality || "[]"); } catch {}
    while (qualities.length < photos.length) qualities.push(null);

    photos.splice(photoIndex, 1);
    qualities.splice(photoIndex, 1);

    await db.update(crewProfilesTable)
      .set({ portfolioPhotos: JSON.stringify(photos), photoQuality: JSON.stringify(qualities), updatedAt: new Date() })
      .where(eq(crewProfilesTable.id, crewId));

    res.json({ ok: true, portfolioPhotos: photos, photoQuality: qualities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Delete crew ──────────────────────────────────────────────────────────────
router.delete("/admin/crew/:id", requireAdmin, async (req: any, res) => {
  try {
    const { password } = req.body ?? {};
    if (!password) return res.status(400).json({ error: "Password is required" });

    // Verify the acting admin's password
    const adminUserId = req.session?.userId;
    const [adminUser] = await db.select({ passwordHash: usersTable.passwordHash })
      .from(usersTable).where(eq(usersTable.id, adminUserId));
    if (!adminUser) return res.status(401).json({ error: "Unauthorised" });
    const valid = await bcrypt.compare(password, adminUser.passwordHash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    const crewId = parseInt(req.params.id);
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    if (!profile) return res.status(404).json({ error: "Crew not found" });

    // Snapshot GCS paths before any DB deletion so we can clean them up afterwards.
    const storagePaths = extractStoragePaths(profile);

    // 1. Null out referrals where this user was referred (FK: referrals.referred_user_id → users.id)
    await db.update(referralsTable)
      .set({ referredUserId: null })
      .where(eq(referralsTable.referredUserId, profile.userId));

    // 2. Delete referrals where this crew is the referrer (FK: referrals.referrer_id → crew_profiles.id)
    await db.delete(referralsTable).where(eq(referralsTable.referrerId, crewId));

    // 3. Get all shift claim IDs for this crew, then delete attendance breaks for them
    const claims = await db.select({ id: shiftClaimsTable.id })
      .from(shiftClaimsTable).where(eq(shiftClaimsTable.crewId, crewId));
    if (claims.length > 0) {
      for (const claim of claims) {
        await db.delete(attendanceBreaksTable).where(eq(attendanceBreaksTable.claimId, claim.id));
      }
    }

    // 4. Delete payments and shift claims
    await db.delete(paymentsTable).where(eq(paymentsTable.crewId, crewId));
    await db.delete(shiftClaimsTable).where(eq(shiftClaimsTable.crewId, crewId));

    // 5. Delete the crew profile and user account
    await db.delete(crewProfilesTable).where(eq(crewProfilesTable.id, crewId));
    await db.delete(usersTable).where(eq(usersTable.id, profile.userId));

    // 6. Best-effort GCS cleanup — runs after DB deletion so files are no longer
    //    reachable even if cloud deletion fails.  Errors are logged but do not
    //    affect the HTTP response.
    if (storagePaths.length > 0) {
      Promise.allSettled(storagePaths.map(p => objectStorage.deleteObject(p)))
        .then(results => {
          const failed = results.filter(r => r.status === "rejected");
          if (failed.length > 0) {
            console.error(`[crew-delete] ${failed.length}/${storagePaths.length} GCS deletions failed for crew ${crewId}`);
          } else {
            console.log(`[crew-delete] Deleted ${storagePaths.length} GCS object(s) for crew ${crewId}`);
          }
        });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete crew error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Shift Claims ─────────────────────────────────────────────────────────────
router.get("/admin/shift-claims", requireAdmin, async (req: any, res) => {
  try {
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
        crewName: usersTable.name,
        crewEmail: usersTable.email,
        crewPhone: crewProfilesTable.phone,
        crewPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        crewUserId: crewProfilesTable.userId,
        checkedInAt: shiftClaimsTable.checkedInAt,
        checkInLat: shiftClaimsTable.checkInLat,
        checkInLng: shiftClaimsTable.checkInLng,
        checkInPhotoUrl: shiftClaimsTable.selfieImage,
        isAbsent: shiftClaimsTable.isAbsent,
        checkInStatus: shiftClaimsTable.checkInStatus,
        checkOutAt: shiftClaimsTable.checkOutAt,
        checkOutStatus: shiftClaimsTable.checkOutStatus,
        breakStartAt: shiftClaimsTable.breakStartAt,
        breakEndAt: shiftClaimsTable.breakEndAt,
        totalBreakMinutes: shiftClaimsTable.totalBreakMinutes,
        breakExceeded: shiftClaimsTable.breakExceeded,
        checkOutLat: shiftClaimsTable.checkOutLat,
        checkOutLng: shiftClaimsTable.checkOutLng,
        checkOutPhotoUrl: shiftClaimsTable.checkOutPhotoUrl,
        attendanceDate: shiftClaimsTable.attendanceDate,
        attendanceApproved: shiftClaimsTable.attendanceApproved,
        approvedPay: shiftClaimsTable.approvedPay,
        isOverride: shiftClaimsTable.isOverride,
        overrideReason: shiftClaimsTable.overrideReason,
        distanceFromEvent: shiftClaimsTable.distanceFromEvent,
        appliedRoles: shiftClaimsTable.appliedRoles,
        assignedRole: shiftClaimsTable.assignedRole,
        eventId: eventsTable.id,
        eventExpectedCheckIn: eventsTable.expectedCheckIn,
        eventExpectedCheckOut: eventsTable.expectedCheckOut,
        eventLateThreshold: eventsTable.lateThresholdMinutes,
        eventAllowedBreakMinutes: eventsTable.allowedBreakMinutes,
        eventBreakWindowStart: eventsTable.breakWindowStart,
        eventBreakWindowEnd: eventsTable.breakWindowEnd,
        eventLatitude: eventsTable.latitude,
        eventLongitude: eventsTable.longitude,
      })
      .from(shiftClaimsTable)
      .innerJoin(shiftsTable, eq(shiftClaimsTable.shiftId, shiftsTable.id))
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .innerJoin(crewProfilesTable, eq(shiftClaimsTable.crewId, crewProfilesTable.id))
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id));

    // ── Referral info: is this claim from a referred candidate? ───────────────
    const referralMap: Record<string, { referrerName: string; referrerId: number }> = {};
    if (claims.length > 0) {
      const userIds = [...new Set(claims.map(c => c.crewUserId).filter(Boolean) as number[])];
      const eventIds = [...new Set(claims.map(c => c.eventId).filter(Boolean) as number[])];

      if (userIds.length > 0 && eventIds.length > 0) {
        const refRows = await db
          .select({
            referredUserId: referralsTable.referredUserId,
            referrerId: referralsTable.referrerId,
            eventId: referralsTable.eventId,
          })
          .from(referralsTable)
          .where(and(
            inArray(referralsTable.referredUserId, userIds),
            inArray(referralsTable.eventId, eventIds),
          ));

        if (refRows.length > 0) {
          const referrerIds = [...new Set(refRows.map(r => r.referrerId).filter(Boolean) as number[])];
          const referrerProfiles = await db
            .select({ id: crewProfilesTable.id, name: usersTable.name })
            .from(crewProfilesTable)
            .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
            .where(inArray(crewProfilesTable.id, referrerIds));

          const referrerNameMap: Record<number, string> = {};
          for (const r of referrerProfiles) referrerNameMap[r.id] = r.name;

          for (const row of refRows) {
            if (row.referredUserId && row.referrerId && row.eventId) {
              const key = `${row.referredUserId}-${row.eventId}`;
              if (!referralMap[key]) {
                referralMap[key] = {
                  referrerName: referrerNameMap[row.referrerId] || "Unknown",
                  referrerId: row.referrerId,
                };
              }
            }
          }
        }
      }
    }

    const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2, revoked: 3 };
    const sorted = claims.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
    res.json(sorted.map(c => {
      const refKey = `${c.crewUserId}-${c.eventId}`;
      const refInfo = referralMap[refKey] || null;
      return {
        ...c,
        totalPay: parseFloat(c.totalPay || "0"),
        eventPayPerDay: parseFloat(c.eventPayPerDay || "0"),
        approvedPay: c.approvedPay !== null && c.approvedPay !== undefined ? parseFloat(c.approvedPay) : null,
        checkInStatus:  computeCheckInStatus(c.checkedInAt,  c.eventExpectedCheckIn,  c.eventStartDate),
        checkOutStatus: computeCheckOutStatus(c.checkOutAt, c.eventExpectedCheckOut, c.eventStartDate),
        isReferral: !!refInfo,
        referrerName: refInfo?.referrerName || null,
        referrerProfileId: refInfo?.referrerId || null,
        appliedRoles: c.appliedRoles ? JSON.parse(c.appliedRoles) : [],
        assignedRole: c.assignedRole || null,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/assign-role", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { role } = req.body;
    if (!role || typeof role !== "string") return res.status(400).json({ error: "Role is required" });
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    await db.update(shiftClaimsTable).set({ assignedRole: role, updatedAt: new Date() }).where(eq(shiftClaimsTable.id, claimId));
    res.json({ success: true, assignedRole: role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/approve", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    await db.update(shiftClaimsTable).set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() }).where(eq(shiftClaimsTable.id, claimId));

    // Sync user status: auto-approve if still pending/resubmitted
    const [profile] = await db.select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable).where(eq(crewProfilesTable.id, claim.crewId));
    if (profile) {
      const [user] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, profile.userId));
      if (user && (user.status === "pending" || user.status === "resubmitted")) {
        await db.update(usersTable).set({ status: "approved", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
      }
    }

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    if (shift) {
      const newFilled = shift.spotsFilled + 1;
      const newStatus = newFilled >= shift.spotsTotal ? "claimed" : "open";
      await db.update(shiftsTable).set({ spotsFilled: newFilled, status: newStatus, updatedAt: new Date() }).where(eq(shiftsTable.id, shift.id));
      await syncReferralOnClaimChange(claim.crewId, shift.eventId, "approved");
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/reject", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    await db.update(shiftClaimsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(shiftClaimsTable.id, claimId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/revoke", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (claim.status !== "approved") return res.status(400).json({ error: "Only approved claims can be revoked" });
    await db.update(shiftClaimsTable).set({ status: "revoked", updatedAt: new Date() }).where(eq(shiftClaimsTable.id, claimId));
    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    if (shift) {
      const newFilled = Math.max(0, shift.spotsFilled - 1);
      await db.update(shiftsTable).set({ spotsFilled: newFilled, status: "open", updatedAt: new Date() }).where(eq(shiftsTable.id, shift.id));
      await syncReferralOnClaimChange(claim.crewId, shift.eventId, "revoked");
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/shift-claims/:id", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { status: newStatus } = req.body as { status: string };
    const allowed = ["approved", "rejected", "pending"];
    if (!allowed.includes(newStatus)) return res.status(400).json({ error: "Invalid status" });

    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const prev = claim.status;

    const updates: any = { status: newStatus, updatedAt: new Date() };
    if (newStatus === "approved") updates.approvedAt = new Date();
    if (newStatus === "pending") updates.approvedAt = null;

    await db.update(shiftClaimsTable).set(updates).where(eq(shiftClaimsTable.id, claimId));

    // Sync user status when claim is newly approved
    if (prev !== "approved" && newStatus === "approved") {
      const [profile] = await db.select({ userId: crewProfilesTable.userId })
        .from(crewProfilesTable).where(eq(crewProfilesTable.id, claim.crewId));
      if (profile) {
        const [user] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, profile.userId));
        if (user && (user.status === "pending" || user.status === "resubmitted")) {
          await db.update(usersTable).set({ status: "approved", updatedAt: new Date() }).where(eq(usersTable.id, profile.userId));
        }
      }
    }

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    if (shift) {
      // Overbooking guard: count live approved claims for this shift
      if (prev !== "approved" && newStatus === "approved") {
        const [{ value: approvedCount }] = await db
          .select({ value: count() })
          .from(shiftClaimsTable)
          .where(and(eq(shiftClaimsTable.shiftId, shift.id), eq(shiftClaimsTable.status, "approved")));
        if (approvedCount >= shift.spotsTotal) {
          return res.status(409).json({ error: "All slots are filled. Revoke an existing approval first." });
        }
      }

      let newFilled = shift.spotsFilled;
      if (prev !== "approved" && newStatus === "approved") newFilled = shift.spotsFilled + 1;
      if (prev === "approved" && newStatus !== "approved") newFilled = Math.max(0, shift.spotsFilled - 1);
      const shiftStatus = newFilled >= shift.spotsTotal ? "claimed" : "open";
      await db.update(shiftsTable).set({ spotsFilled: newFilled, status: shiftStatus, updatedAt: new Date() }).where(eq(shiftsTable.id, shift.id));
      await syncReferralOnClaimChange(claim.crewId, shift.eventId, newStatus);
    }

    console.log(`[claims] Claim ${claimId}: ${prev} → ${newStatus}`);
    res.json({ success: true, claimId, from: prev, to: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Attendance management ────────────────────────────────────────────────────

router.delete("/admin/shift-claims/:id/checkin", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (!claim.checkedInAt) return res.status(400).json({ error: "Not checked in" });

    await db.update(shiftClaimsTable)
      .set({ checkedInAt: null, checkInStatus: null, checkInLat: null, checkInLng: null, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[claims] Undo check-in: claim ${claimId}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/shift-claims/:id/checkout", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (!claim.checkOutAt) return res.status(400).json({ error: "Not checked out" });

    await db.update(shiftClaimsTable)
      .set({ checkOutAt: null, checkOutStatus: null, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/mark-present", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    // Resolve the event so we can compute check-in status dynamically.
    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));
    const now = new Date();
    const checkInStatus = computeCheckInStatus(now, event.expectedCheckIn, event.startDate) ?? "on-time";
    const attendanceDate = getISTDate(now);

    await db.update(shiftClaimsTable)
      .set({ checkedInAt: now, attendanceDate, checkInStatus, isAbsent: false, updatedAt: now })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[attendance] Admin check-in claim ${claimId}: ${checkInStatus} attendanceDate=${attendanceDate}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/shift-claims/:id/mark-checkout", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (!claim.checkedInAt) return res.status(400).json({ error: "Crew has not checked in yet" });

    // Resolve the event so we can compute check-out status dynamically.
    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));
    const now = new Date();
    const checkOutStatus = computeCheckOutStatus(now, event.expectedCheckOut, event.startDate);

    await db.update(shiftClaimsTable)
      .set({ checkOutAt: now, checkOutStatus: checkOutStatus ?? null, updatedAt: now })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[attendance] Admin check-out claim ${claimId}: ${checkOutStatus ?? "on-time"}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/shift-claims/:id/absent", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { absent } = req.body as { absent: boolean };
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    await db.update(shiftClaimsTable)
      .set({ isAbsent: !!absent, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    console.log(`[claims] Mark absent=${absent}: claim ${claimId}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: edit times ─────────────────────────────────────────────
router.patch("/admin/shift-claims/:id/edit-times", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { checkedInAt, checkOutAt, breakStartAt, breakEndAt } = req.body as {
      checkedInAt?: string | null;
      checkOutAt?: string | null;
      breakStartAt?: string | null;
      breakEndAt?: string | null;
    };
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    // Resolve event to recompute statuses from expected times.
    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (checkedInAt !== undefined) updates.checkedInAt = checkedInAt ? new Date(checkedInAt) : null;
    if (checkOutAt !== undefined) updates.checkOutAt = checkOutAt ? new Date(checkOutAt) : null;
    if (breakStartAt !== undefined) updates.breakStartAt = breakStartAt ? new Date(breakStartAt) : null;
    if (breakEndAt !== undefined) updates.breakEndAt = breakEndAt ? new Date(breakEndAt) : null;

    if (updates.breakStartAt !== undefined && updates.breakEndAt !== undefined &&
        updates.breakStartAt && updates.breakEndAt) {
      const breakMins = Math.round((new Date(updates.breakEndAt).getTime() - new Date(updates.breakStartAt).getTime()) / 60000);
      updates.totalBreakMinutes = Math.max(0, breakMins);
    } else if (updates.breakStartAt === null || updates.breakEndAt === null) {
      updates.totalBreakMinutes = 0;
    }

    // Recompute checkInStatus from the new (or existing) checkedInAt vs expectedCheckIn.
    const newCheckedInAt = "checkedInAt" in updates ? updates.checkedInAt : claim.checkedInAt;
    if (newCheckedInAt) {
      updates.checkInStatus = computeCheckInStatus(newCheckedInAt, event.expectedCheckIn, event.startDate) ?? "on-time";
    } else {
      updates.checkInStatus = null;
      updates.isAbsent = false;
    }

    // Recompute checkOutStatus from the new (or existing) checkOutAt vs expectedCheckOut.
    const newCheckOutAt = "checkOutAt" in updates ? updates.checkOutAt : claim.checkOutAt;
    updates.checkOutStatus = newCheckOutAt
      ? (computeCheckOutStatus(newCheckOutAt, event.expectedCheckOut, event.startDate) ?? null)
      : null;

    await db.update(shiftClaimsTable).set(updates).where(eq(shiftClaimsTable.id, claimId));
    console.log(`[attendance] Admin edited times for claim ${claimId} | checkInStatus=${updates.checkInStatus} checkOutStatus=${updates.checkOutStatus}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin: break records for a claim ─────────────────────────────────────────
router.get("/admin/shift-claims/:id/breaks", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const breaks = await db.select().from(attendanceBreaksTable)
      .where(eq(attendanceBreaksTable.claimId, claimId));
    res.json(breaks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: event settings ────────────────────────────────────────
router.patch("/admin/events/:id/attendance-settings", requireAdmin, async (req: any, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { expectedCheckIn, expectedCheckOut, lateThresholdMinutes, breakWindowStart, breakWindowEnd, allowedBreakMinutes } = req.body as {
      expectedCheckIn?: string;
      expectedCheckOut?: string;
      lateThresholdMinutes?: number;
      breakWindowStart?: string | null;
      breakWindowEnd?: string | null;
      allowedBreakMinutes?: number | null;
    };
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
    if (!event) return res.status(404).json({ error: "Event not found" });

    await db.update(eventsTable).set({
      ...(expectedCheckIn !== undefined && { expectedCheckIn }),
      ...(expectedCheckOut !== undefined && { expectedCheckOut }),
      ...(lateThresholdMinutes !== undefined && { lateThresholdMinutes }),
      ...(breakWindowStart !== undefined && { breakWindowStart: breakWindowStart || null }),
      ...(breakWindowEnd !== undefined && { breakWindowEnd: breakWindowEnd || null }),
      ...(allowedBreakMinutes !== undefined && { allowedBreakMinutes: allowedBreakMinutes || null }),
      updatedAt: new Date(),
    }).where(eq(eventsTable.id, eventId));

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get("/admin/stats", requireAdmin, async (req: any, res) => {
  try {
    const [{ value: totalCrew }] = await db.select({ value: count() }).from(crewProfilesTable);
    const allUsers = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.role, "crew"));
    const pendingApprovals = allUsers.filter(u => u.status === "pending" || u.status === "resubmitted").length;
    const approvedCount = allUsers.filter(u => u.status === "approved" || u.status === "active").length;
    const rejectedCount = allUsers.filter(u => u.status === "rejected").length;
    const resubmittedCount = allUsers.filter(u => u.status === "resubmitted").length;
    const blacklistedCount = allUsers.filter(u => u.status === "blacklisted").length;

    const [{ value: totalEvents }] = await db.select({ value: count() }).from(eventsTable);
    const activeEvents = await db.select().from(eventsTable).where(eq(eventsTable.status, "ongoing"));
    const upcomingEvents = await db.select().from(eventsTable).where(eq(eventsTable.status, "upcoming"));
    const [{ value: totalShifts }] = await db.select({ value: count() }).from(shiftsTable);
    const openShifts = await db.select().from(shiftsTable).where(eq(shiftsTable.status, "open"));
    const pendingClaims = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.status, "pending"));

    const allPayments = await db.select().from(paymentsTable);
    const totalPaymentsOwed = allPayments.filter(p => p.status !== "paid").reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    const totalPaid = allPayments.filter(p => p.status === "paid").reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

    res.json({
      totalCrew,
      pendingApprovals,
      approvedCount,
      rejectedCount,
      resubmittedCount,
      blacklistedCount,
      totalEvents,
      activeEvents: activeEvents.length + upcomingEvents.length,
      totalShifts,
      openShifts: openShifts.length,
      pendingShiftClaims: pendingClaims.length,
      totalPaymentsOwed,
      totalPaid,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Change Password ────────────────────────────────────────────────────────────
router.post("/admin/change-password", requireAdmin, async (req: any, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const [admin] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId));

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect current password", code: "WRONG_PASSWORD" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must differ from current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, req.session.userId));

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: approve-attendance ────────────────────────────────────
router.post("/admin/shift-claims/:id/approve-attendance", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const { payAmount, overrideReason } = req.body as { payAmount?: number; overrideReason?: string };

    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));

    // Auto-calculate pay if no override provided
    let finalPay = payAmount;
    if (finalPay === undefined || finalPay === null) {
      const base = parseFloat(shift.totalPay || "0") || parseFloat(event.payPerDay || "0") || 0;
      if (claim.checkedInAt && claim.checkOutAt && event.expectedCheckIn && event.expectedCheckOut) {
        const dateStr = event.startDate.toISOString().split("T")[0];
        const [inH, inM] = event.expectedCheckIn.split(":").map(Number);
        const [outH, outM] = event.expectedCheckOut.split(":").map(Number);
        const expIn  = new Date(`${dateStr}T${String(inH).padStart(2,"0")}:${String(inM).padStart(2,"0")}:00+05:30`);
        const expOut = new Date(`${dateStr}T${String(outH).padStart(2,"0")}:${String(outM).padStart(2,"0")}:00+05:30`);
        const expMs  = expOut.getTime() - expIn.getTime();
        if (expMs > 0) {
          const actualMs = new Date(claim.checkOutAt).getTime() - new Date(claim.checkedInAt).getTime() - (claim.totalBreakMinutes || 0) * 60000;
          const ratio = Math.min(1, Math.max(0, actualMs / expMs));
          finalPay = Math.round(base * ratio);
        } else {
          finalPay = base;
        }
      } else {
        finalPay = claim.checkedInAt ? base : 0;
      }
    }

    const isOverride = !!(overrideReason && overrideReason.trim());
    const now = new Date();
    await db.update(shiftClaimsTable)
      .set({
        attendanceApproved: true,
        approvedPay: String(finalPay),
        isOverride,
        overrideReason: isOverride ? overrideReason!.trim() : null,
        isAbsent: false,
        updatedAt: now,
      })
      .where(eq(shiftClaimsTable.id, claimId));

    // Upsert payment record
    const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.shiftClaimId, claimId));
    if (existing.length > 0) {
      await db.update(paymentsTable)
        .set({ amount: String(finalPay), status: "pending", updatedAt: now })
        .where(eq(paymentsTable.shiftClaimId, claimId));
    } else {
      await db.insert(paymentsTable).values({
        crewId: claim.crewId,
        shiftClaimId: claimId,
        amount: String(finalPay),
        status: "pending",
      });
    }

    // Trigger referral completion: mark referral successful + credit reward to referrer
    await syncReferralOnAttendanceApproval(claim.crewId, shift.eventId);

    console.log(`[attendance] Approved claim ${claimId} | pay=₹${finalPay}`);
    res.json({ success: true, approvedPay: finalPay });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: reject-attendance ─────────────────────────────────────
router.post("/admin/shift-claims/:id/reject-attendance", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const now = new Date();
    await db.update(shiftClaimsTable)
      .set({ attendanceApproved: false, approvedPay: "0", isAbsent: true, updatedAt: now })
      .where(eq(shiftClaimsTable.id, claimId));

    // Upsert payment record with 0
    const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.shiftClaimId, claimId));
    if (existing.length > 0) {
      await db.update(paymentsTable)
        .set({ amount: "0", status: "failed", updatedAt: now })
        .where(eq(paymentsTable.shiftClaimId, claimId));
    } else {
      await db.insert(paymentsTable).values({
        crewId: claim.crewId,
        shiftClaimId: claimId,
        amount: "0",
        status: "failed",
      });
    }

    console.log(`[attendance] Rejected claim ${claimId}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: undo approval/rejection ────────────────────────────────
router.post("/admin/shift-claims/:id/undo-attendance", requireAdmin, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const [claim] = await db.select().from(shiftClaimsTable).where(eq(shiftClaimsTable.id, claimId));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    await db.update(shiftClaimsTable)
      .set({ attendanceApproved: null, approvedPay: null, isOverride: false, overrideReason: null, isAbsent: false, updatedAt: new Date() })
      .where(eq(shiftClaimsTable.id, claimId));

    await db.delete(paymentsTable).where(eq(paymentsTable.shiftClaimId, claimId));

    console.log(`[attendance] Undid attendance decision for claim ${claimId}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Admin attendance: approve-all-safe ──────────────────────────────────────
router.post("/admin/attendance/approve-all-safe", requireAdmin, async (req: any, res) => {
  try {
    const { eventId } = req.body as { eventId?: number };

    // Find all approved claims with check-in + selfie + not yet reviewed
    let query = db
      .select({
        claim: shiftClaimsTable,
        shift: shiftsTable,
        event: eventsTable,
      })
      .from(shiftClaimsTable)
      .innerJoin(shiftsTable, eq(shiftClaimsTable.shiftId, shiftsTable.id))
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .$dynamic();

    const conditions = [
      eq(shiftClaimsTable.status, "approved"),
      isNotNull(shiftClaimsTable.checkedInAt),
      isNotNull(shiftClaimsTable.selfieImage),
      isNull(shiftClaimsTable.attendanceApproved),
    ];
    if (eventId) conditions.push(eq(eventsTable.id, eventId));

    const pending = await query.where(and(...conditions));

    let approvedCount = 0;
    const now = new Date();

    for (const row of pending) {
      const { claim, shift, event } = row;

      // Compute auto-pay
      const base = parseFloat(shift.totalPay || "0") || parseFloat(event.payPerDay || "0") || 0;
      let finalPay = base;
      if (claim.checkedInAt && claim.checkOutAt && event.expectedCheckIn && event.expectedCheckOut) {
        const dateStr = event.startDate.toISOString().split("T")[0];
        const [inH, inM] = event.expectedCheckIn.split(":").map(Number);
        const [outH, outM] = event.expectedCheckOut.split(":").map(Number);
        const expIn  = new Date(`${dateStr}T${String(inH).padStart(2,"0")}:${String(inM).padStart(2,"0")}:00+05:30`);
        const expOut = new Date(`${dateStr}T${String(outH).padStart(2,"0")}:${String(outM).padStart(2,"0")}:00+05:30`);
        const expMs  = expOut.getTime() - expIn.getTime();
        if (expMs > 0) {
          const actualMs = new Date(claim.checkOutAt).getTime() - new Date(claim.checkedInAt).getTime() - (claim.totalBreakMinutes || 0) * 60000;
          const ratio = Math.min(1, Math.max(0, actualMs / expMs));
          finalPay = Math.round(base * ratio);
        }
      }

      await db.update(shiftClaimsTable)
        .set({ attendanceApproved: true, approvedPay: String(finalPay), isAbsent: false, updatedAt: now })
        .where(eq(shiftClaimsTable.id, claim.id));

      const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.shiftClaimId, claim.id));
      if (existing.length > 0) {
        await db.update(paymentsTable)
          .set({ amount: String(finalPay), status: "pending", updatedAt: now })
          .where(eq(paymentsTable.shiftClaimId, claim.id));
      } else {
        await db.insert(paymentsTable).values({
          crewId: claim.crewId,
          shiftClaimId: claim.id,
          amount: String(finalPay),
          status: "pending",
        });
      }

      // Trigger referral completion for each approved claim
      await syncReferralOnAttendanceApproval(claim.crewId, event.id);
      approvedCount++;
    }

    console.log(`[attendance] Approve-all-safe: approved ${approvedCount} claims`);
    res.json({ success: true, approvedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;

