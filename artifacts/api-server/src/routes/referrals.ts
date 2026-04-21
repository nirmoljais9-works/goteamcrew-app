import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { referralsTable, crewProfilesTable, eventsTable, usersTable, shiftsTable, shiftClaimsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function requireNotBlacklisted(req: any, res: any, next: any) {
  if (req.session?.status === "blacklisted") return res.status(403).json({ error: "Account restricted" });
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// POST /referrals — create or fetch referral for an event
router.post("/referrals", requireAuth, requireNotBlacklisted, async (req: any, res) => {
  try {
    if (req.session.role === "admin") return res.status(403).json({ error: "Admins cannot create referrals." });

    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "eventId is required" });

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, parseInt(eventId)));
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Check if referral already exists for this referrer+event
    const [existing] = await db
      .select()
      .from(referralsTable)
      .where(and(eq(referralsTable.referrerId, profile.id), eq(referralsTable.eventId, parseInt(eventId))));

    let referralCode: string;
    if (existing) {
      referralCode = existing.referralCode;
    } else {
      referralCode = `${profile.id}-${parseInt(eventId)}`;
      await db.insert(referralsTable).values({
        eventId: parseInt(eventId),
        referrerId: profile.id,
        referralCode,
        status: "pending",
        rewardAmount: event.referralReward || null,
      });
      // totalReferrals is incremented only when someone actually registers via the link
      // (handled in auth registration route), not at link-generation time.
    }

    const origin = process.env.APP_ORIGIN || `https://${req.headers.host}`;
    // Link format: /register?ref=CREW_PROFILE_ID&event=EVENT_ID
    const referralLink = `${origin}/register?ref=${profile.id}&event=${parseInt(eventId)}`;

    const DEFAULT_REFERRAL_MSG = `Hey 👋\n\nThere's a paid event opportunity on Goteamcrew.\n\nYou'll need to register first (takes 1–2 mins), then you can view details and apply.\n\nLet me know if you need help 🙂`;
    const baseMessage = (event as any).referralMessage || DEFAULT_REFERRAL_MSG;
    const finalMessage = `${baseMessage}\n\nHere's the link:\n${referralLink}`;

    res.status(201).json({
      referralCode,
      referralLink,
      eventTitle: event.title,
      eventLocation: event.location,
      eventStartDate: event.startDate,
      payPerDay: event.payPerDay,
      referralReward: event.referralReward,
      whatsappMessage: finalMessage,
    });
  } catch (err) {
    console.error("[referrals] POST error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /crew/referrals — my referrals + earnings summary
router.get("/crew/referrals", requireAuth, requireNotBlacklisted, async (req: any, res) => {
  try {
    if (req.session.role === "admin") return res.status(403).json({ error: "Admin only endpoint N/A" });

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const referrals = await db
      .select({
        id: referralsTable.id,
        eventId: referralsTable.eventId,
        eventTitle: eventsTable.title,
        eventDate: eventsTable.startDate,
        referralCode: referralsTable.referralCode,
        referredPhone: referralsTable.referredPhone,
        status: referralsTable.status,
        rewardAmount: referralsTable.rewardAmount,
        rewardPaid: referralsTable.rewardPaid,
        referredUserId: referralsTable.referredUserId,
        createdAt: referralsTable.createdAt,
      })
      .from(referralsTable)
      .innerJoin(eventsTable, eq(referralsTable.eventId, eventsTable.id))
      .where(eq(referralsTable.referrerId, profile.id))
      .orderBy(desc(referralsTable.createdAt));

    // Pending earnings = approved by admin (status = successful) but not yet paid out
    const pendingEarnings = referrals
      .filter(r => r.status === "successful" && r.rewardAmount && r.rewardPaid !== "yes")
      .reduce((sum, r) => sum + parseFloat(r.rewardAmount as string), 0);

    const origin = process.env.APP_ORIGIN || `https://${req.headers.host}`;

    // Resolved referred user names
    const referredNames: Record<number, string> = {};
    const userIds = referrals.map(r => r.referredUserId).filter(Boolean) as number[];
    if (userIds.length > 0) {
      const users = await db.select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of users) referredNames[u.id] = u.name;
    }

    // Compute counts from live referral data — avoids stale profile counters
    // "Referred" = people who actually registered via the link
    // "Successful" = only those who completed the event (attendance approved)
    const totalReferrals      = referrals.filter(r => r.referredUserId != null).length;
    const successfulReferrals = referrals.filter(r => ["successful", "confirmed", "paid"].includes(r.status as string)).length;

    res.json({
      walletBalance: profile.walletBalance || "0",
      pendingEarnings: pendingEarnings.toFixed(2),
      totalReferrals,
      successfulReferrals,
      referrals: referrals.map(r => ({
        ...r,
        referralLink: `${origin}/register?ref=${profile.id}&event=${r.eventId}`,
        referredUserName: r.referredUserId ? (referredNames[r.referredUserId] || null) : null,
      })),
    });
  } catch (err) {
    console.error("[referrals] GET /crew/referrals error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/referrals — admin: get referrals with filters
// ?status=pending_approval|successful|paid|rejected|all
// ?eventId=X
// ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/admin/referrals", requireAdmin, async (req: any, res) => {
  try {
    const eventId = req.query.eventId ? parseInt(req.query.eventId as string) : null;
    const statusFilter = (req.query.status as string) || "all";

    const rows = await db
      .select({
        id: referralsTable.id,
        eventId: referralsTable.eventId,
        eventTitle: eventsTable.title,
        eventStartDate: eventsTable.startDate,
        eventEndDate: eventsTable.endDate,
        referrerId: referralsTable.referrerId,
        referrerName: usersTable.name,
        referrerPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        referredUserId: referralsTable.referredUserId,
        referredPhone: referralsTable.referredPhone,
        status: referralsTable.status,
        rewardAmount: referralsTable.rewardAmount,
        rewardPaid: referralsTable.rewardPaid,
        createdAt: referralsTable.createdAt,
        updatedAt: referralsTable.updatedAt,
      })
      .from(referralsTable)
      .innerJoin(eventsTable, eq(referralsTable.eventId, eventsTable.id))
      .innerJoin(crewProfilesTable, eq(referralsTable.referrerId, crewProfilesTable.id))
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
      .orderBy(desc(referralsTable.updatedAt));

    // Resolve referred user names
    const referredIds = rows.map(r => r.referredUserId).filter(Boolean) as number[];
    const referredNames: Record<number, string> = {};
    if (referredIds.length > 0) {
      const users = await db.select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, referredIds));
      for (const u of users) referredNames[u.id] = u.name;
    }

    let result = rows.map(r => ({
      ...r,
      referredUserName: r.referredUserId ? (referredNames[r.referredUserId] || null) : null,
    }));

    // Filter by status
    const actionableStatuses = ["pending_approval", "successful", "paid", "rejected", "confirmed"];
    result = result.filter(r => actionableStatuses.includes(r.status as string));

    if (statusFilter !== "all") {
      result = result.filter(r => r.status === statusFilter);
    }

    // Filter by event
    if (eventId) {
      result = result.filter(r => r.eventId === eventId);
    }

    res.json(result);
  } catch (err) {
    console.error("[referrals] GET /admin/referrals error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/referrals/:id/approve — admin approves referral → "successful" (pending payout)
router.post("/admin/referrals/:id/approve", requireAdmin, async (req: any, res) => {
  try {
    const refId = parseInt(req.params.id);
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.id, refId));
    if (!referral) return res.status(404).json({ error: "Referral not found" });
    if (!["pending_approval", "selected"].includes(referral.status as string)) {
      return res.status(400).json({ error: `Cannot approve referral in status: ${referral.status}` });
    }

    await db.update(referralsTable).set({
      status: "successful" as any,
      updatedAt: new Date(),
    }).where(eq(referralsTable.id, refId));

    res.json({ success: true });
  } catch (err) {
    console.error("[referrals] POST /admin/referrals/:id/approve error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/referrals/:id/paid — admin marks payment done → credits wallet
router.post("/admin/referrals/:id/paid", requireAdmin, async (req: any, res) => {
  try {
    const refId = parseInt(req.params.id);
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.id, refId));
    if (!referral) return res.status(404).json({ error: "Referral not found" });
    if (!["successful", "confirmed"].includes(referral.status as string)) {
      return res.status(400).json({ error: `Cannot mark paid for referral in status: ${referral.status}` });
    }
    if (referral.rewardPaid === "yes") return res.status(400).json({ error: "Already paid" });

    const rewardAmount = referral.rewardAmount ? parseFloat(referral.rewardAmount as string) : 0;

    await db.update(referralsTable).set({
      status: "paid" as any,
      rewardPaid: "yes",
      updatedAt: new Date(),
    }).where(eq(referralsTable.id, refId));

    if (rewardAmount > 0) {
      await db.update(crewProfilesTable).set({
        walletBalance: sql`${crewProfilesTable.walletBalance} + ${rewardAmount}`,
        successfulReferrals: sql`${crewProfilesTable.successfulReferrals} + 1`,
        updatedAt: new Date(),
      }).where(eq(crewProfilesTable.id, referral.referrerId));
    } else {
      await db.update(crewProfilesTable).set({
        successfulReferrals: sql`${crewProfilesTable.successfulReferrals} + 1`,
        updatedAt: new Date(),
      }).where(eq(crewProfilesTable.id, referral.referrerId));
    }

    res.json({ success: true, rewardAmount });
  } catch (err) {
    console.error("[referrals] POST /admin/referrals/:id/paid error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/referrals/:id/confirm — legacy alias for approve (backward compat)
router.post("/admin/referrals/:id/confirm", requireAdmin, async (req: any, res) => {
  try {
    const refId = parseInt(req.params.id);
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.id, refId));
    if (!referral) return res.status(404).json({ error: "Referral not found" });

    await db.update(referralsTable).set({
      status: "successful" as any,
      updatedAt: new Date(),
    }).where(eq(referralsTable.id, refId));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/referrals/:id/reject — admin rejects referral (no reward)
router.post("/admin/referrals/:id/reject", requireAdmin, async (req: any, res) => {
  try {
    const refId = parseInt(req.params.id);
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.id, refId));
    if (!referral) return res.status(404).json({ error: "Referral not found" });
    if (["paid", "confirmed"].includes(referral.status as string)) {
      return res.status(400).json({ error: "Cannot reject a paid referral" });
    }

    await db.update(referralsTable).set({
      status: "rejected" as any,
      updatedAt: new Date(),
    }).where(eq(referralsTable.id, refId));

    res.json({ success: true });
  } catch (err) {
    console.error("[referrals] POST /admin/referrals/:id/reject error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/referrers/:crewProfileId/insights — referrer drawer data
router.get("/admin/referrers/:crewProfileId/insights", requireAdmin, async (req: any, res) => {
  try {
    const crewProfileId = parseInt(req.params.crewProfileId);
    if (isNaN(crewProfileId)) return res.status(400).json({ error: "Invalid id" });

    // Profile
    const [profile] = await db
      .select({
        id: crewProfilesTable.id,
        userId: crewProfilesTable.userId,
        name: usersTable.name,
        email: usersTable.email,
        phone: crewProfilesTable.phone,
        city: crewProfilesTable.city,
        gender: crewProfilesTable.gender,
        category: crewProfilesTable.category,
        experienceLevel: crewProfilesTable.experienceLevel,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        walletBalance: crewProfilesTable.walletBalance,
        totalReferrals: crewProfilesTable.totalReferrals,
        successfulReferrals: crewProfilesTable.successfulReferrals,
        totalEarnings: crewProfilesTable.totalEarnings,
        completedShifts: crewProfilesTable.completedShifts,
        age: crewProfilesTable.age,
        languages: crewProfilesTable.languages,
        skills: crewProfilesTable.skills,
        instagramUrl: crewProfilesTable.instagramUrl,
        height: crewProfilesTable.height,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
      .where(eq(crewProfilesTable.id, crewProfileId));

    if (!profile) return res.status(404).json({ error: "Referrer not found" });

    // All referrals for this referrer
    const referrals = await db
      .select({
        id: referralsTable.id,
        eventId: referralsTable.eventId,
        eventTitle: eventsTable.title,
        referredUserId: referralsTable.referredUserId,
        referredPhone: referralsTable.referredPhone,
        status: referralsTable.status,
        rewardAmount: referralsTable.rewardAmount,
        createdAt: referralsTable.createdAt,
        updatedAt: referralsTable.updatedAt,
      })
      .from(referralsTable)
      .innerJoin(eventsTable, eq(referralsTable.eventId, eventsTable.id))
      .where(eq(referralsTable.referrerId, crewProfileId))
      .orderBy(desc(referralsTable.updatedAt));

    // Resolve referred user names
    const referredIds = referrals.map(r => r.referredUserId).filter(Boolean) as number[];
    const referredNames: Record<number, string> = {};
    if (referredIds.length > 0) {
      const users = await db.select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable).where(inArray(usersTable.id, referredIds));
      for (const u of users) referredNames[u.id] = u.name;
    }

    const actionableReferrals = referrals.filter(r =>
      ["pending_approval", "successful", "paid", "confirmed", "rejected", "selected", "joined"].includes(r.status as string)
    );

    const stats = {
      total: actionableReferrals.length,
      approved: actionableReferrals.filter(r => ["successful", "confirmed", "paid"].includes(r.status as string)).length,
      rejected: actionableReferrals.filter(r => r.status === "rejected").length,
      pending: actionableReferrals.filter(r => r.status === "pending_approval").length,
      totalEarned: actionableReferrals
        .filter(r => r.status === "paid" && r.rewardAmount)
        .reduce((s, r) => s + parseFloat(r.rewardAmount as string), 0),
      pendingPayout: actionableReferrals
        .filter(r => ["successful", "confirmed"].includes(r.status as string) && r.rewardAmount)
        .reduce((s, r) => s + parseFloat(r.rewardAmount as string), 0),
    };

    res.json({
      profile: { ...profile, walletBalance: parseFloat(profile.walletBalance || "0"), totalEarnings: parseFloat(profile.totalEarnings || "0") },
      stats,
      recentReferrals: actionableReferrals.slice(0, 10).map(r => ({
        ...r,
        referredUserName: r.referredUserId ? (referredNames[r.referredUserId] || null) : null,
      })),
    });
  } catch (err) {
    console.error("[referrers insights] error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/candidate-insight?userId=X&eventId=Y — candidate drawer data
router.get("/admin/candidate-insight", requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.query.userId as string);
    const eventId = parseInt(req.query.eventId as string);
    if (isNaN(userId) || isNaN(eventId)) return res.status(400).json({ error: "userId and eventId required" });

    // Profile
    const [profile] = await db
      .select({
        id: crewProfilesTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: crewProfilesTable.phone,
        city: crewProfilesTable.city,
        gender: crewProfilesTable.gender,
        category: crewProfilesTable.category,
        experienceLevel: crewProfilesTable.experienceLevel,
        closeUpPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
        age: crewProfilesTable.age,
        languages: crewProfilesTable.languages,
        skills: crewProfilesTable.skills,
        height: crewProfilesTable.height,
        instagramUrl: crewProfilesTable.instagramUrl,
        completedShifts: crewProfilesTable.completedShifts,
        totalEarnings: crewProfilesTable.totalEarnings,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
      .where(eq(crewProfilesTable.userId, userId));

    if (!profile) return res.status(404).json({ error: "Candidate profile not found" });

    // Event
    const [event] = await db
      .select({
        id: eventsTable.id,
        title: eventsTable.title,
        location: eventsTable.location,
        startDate: eventsTable.startDate,
        endDate: eventsTable.endDate,
        role: eventsTable.role,
        payPerDay: eventsTable.payPerDay,
        payFemale: eventsTable.payFemale,
        payMale: eventsTable.payMale,
        payFresher: eventsTable.payFresher,
        expectedCheckIn: eventsTable.expectedCheckIn,
        expectedCheckOut: eventsTable.expectedCheckOut,
        lateThresholdMinutes: eventsTable.lateThresholdMinutes,
        allowedBreakMinutes: eventsTable.allowedBreakMinutes,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));

    if (!event) return res.status(404).json({ error: "Event not found" });

    // Shift claim — find the most recent approved or any claim for this crew on this event
    const claims = await db
      .select({
        id: shiftClaimsTable.id,
        shiftId: shiftClaimsTable.shiftId,
        status: shiftClaimsTable.status,
        checkedInAt: shiftClaimsTable.checkedInAt,
        checkOutAt: shiftClaimsTable.checkOutAt,
        isAbsent: shiftClaimsTable.isAbsent,
        checkInStatus: shiftClaimsTable.checkInStatus,
        checkOutStatus: shiftClaimsTable.checkOutStatus,
        totalBreakMinutes: shiftClaimsTable.totalBreakMinutes,
        attendanceApproved: shiftClaimsTable.attendanceApproved,
        approvedPay: shiftClaimsTable.approvedPay,
        isOverride: shiftClaimsTable.isOverride,
        overrideReason: shiftClaimsTable.overrideReason,
        shiftRole: shiftsTable.role,
        shiftStartTime: shiftsTable.startTime,
        shiftEndTime: shiftsTable.endTime,
        shiftTotalPay: shiftsTable.totalPay,
      })
      .from(shiftClaimsTable)
      .innerJoin(shiftsTable, eq(shiftClaimsTable.shiftId, shiftsTable.id))
      .where(and(eq(shiftClaimsTable.crewId, profile.id), eq(shiftsTable.eventId, eventId)))
      .orderBy(desc(shiftClaimsTable.updatedAt));

    const claim = claims.find(c => c.status === "approved") || claims[0] || null;

    // Compute attendance metrics
    let attendanceStatus: "present" | "late" | "no_show" | "pending" = "pending";
    let lateMinutes = 0;
    let hoursWorked = 0;

    if (claim) {
      if (claim.isAbsent) {
        attendanceStatus = "no_show";
      } else if (claim.checkedInAt) {
        const checkIn = new Date(claim.checkedInAt);
        // Determine lateness
        if (event.expectedCheckIn && claim.checkInStatus === "late") {
          const [h, m] = event.expectedCheckIn.split(":").map(Number);
          const expectedMs = new Date(checkIn);
          expectedMs.setHours(h, m, 0, 0);
          lateMinutes = Math.max(0, Math.round((checkIn.getTime() - expectedMs.getTime()) / 60000));
          attendanceStatus = "late";
        } else {
          attendanceStatus = "present";
        }

        if (claim.checkOutAt) {
          const checkOut = new Date(claim.checkOutAt);
          const totalMins = (checkOut.getTime() - checkIn.getTime()) / 60000;
          hoursWorked = Math.max(0, Math.round(((totalMins - (claim.totalBreakMinutes || 0)) / 60) * 10) / 10);
        }
      }
    }

    // Compute base pay using gender/experience logic
    function getBasePay(ev: typeof event, prof: typeof profile): number {
      const isFresher = prof.experienceLevel === "fresher";
      if (isFresher && ev.payFresher) return parseFloat(ev.payFresher as string);
      if (prof.gender === "female" && ev.payFemale) return parseFloat(ev.payFemale as string);
      if (prof.gender === "male" && ev.payMale) return parseFloat(ev.payMale as string);
      if (ev.payPerDay) return parseFloat(ev.payPerDay as string);
      return 0;
    }

    const basePay = getBasePay(event, profile);
    const finalPay = claim?.approvedPay != null ? parseFloat(claim.approvedPay as string) : null;
    const deduction = (finalPay != null && finalPay < basePay) ? basePay - finalPay : 0;

    // Smart decision tag
    let decisionTag: "eligible" | "not_eligible" | "review" = "review";
    if (attendanceStatus === "no_show") decisionTag = "not_eligible";
    else if (attendanceStatus === "present") decisionTag = "eligible";
    else if (attendanceStatus === "late") decisionTag = "review";

    res.json({
      profile: { ...profile, totalEarnings: parseFloat(profile.totalEarnings || "0") },
      event: {
        ...event,
        payPerDay: event.payPerDay ? parseFloat(event.payPerDay as string) : null,
        payFemale: event.payFemale ? parseFloat(event.payFemale as string) : null,
        payMale: event.payMale ? parseFloat(event.payMale as string) : null,
        payFresher: event.payFresher ? parseFloat(event.payFresher as string) : null,
      },
      claim: claim ? {
        ...claim,
        approvedPay: claim.approvedPay != null ? parseFloat(claim.approvedPay as string) : null,
        shiftTotalPay: parseFloat(claim.shiftTotalPay || "0"),
      } : null,
      attendance: {
        status: attendanceStatus,
        lateMinutes,
        hoursWorked,
        checkInTime: claim?.checkedInAt || null,
        checkOutTime: claim?.checkOutAt || null,
        totalBreakMinutes: claim?.totalBreakMinutes || 0,
      },
      payment: {
        basePay,
        deduction: Math.round(deduction),
        finalPay: finalPay != null ? Math.round(finalPay) : null,
        isOverride: claim?.isOverride || false,
        overrideReason: claim?.overrideReason || null,
      },
      decisionTag,
    });
  } catch (err) {
    console.error("[candidate-insight] error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /leaderboard — top referrers
router.get("/leaderboard", requireAuth, async (req: any, res) => {
  try {
    const top = await db
      .select({
        name: usersTable.name,
        successfulReferrals: crewProfilesTable.successfulReferrals,
        totalReferrals: crewProfilesTable.totalReferrals,
        walletBalance: crewProfilesTable.walletBalance,
      })
      .from(crewProfilesTable)
      .innerJoin(usersTable, eq(crewProfilesTable.userId, usersTable.id))
      .where(sql`${crewProfilesTable.totalReferrals} > 0`)
      .orderBy(desc(crewProfilesTable.successfulReferrals), desc(crewProfilesTable.totalReferrals))
      .limit(10);

    res.json(top);
  } catch (err) {
    console.error("[leaderboard] error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
