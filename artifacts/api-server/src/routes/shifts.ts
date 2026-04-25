import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { shiftsTable, shiftClaimsTable, eventsTable, crewProfilesTable, usersTable, referralsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { computeCheckInStatus, computeCheckOutStatus, getISTDate } from "../lib/attendance-utils";

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

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

function formatShift(shift: any) {
  return {
    ...shift,
    hourlyRate: parseFloat(shift.hourlyRate || "0"),
    totalPay: parseFloat(shift.totalPay || "0"),
  };
}

function eventAutoStatus(startDate: Date, endDate: Date): "upcoming" | "ongoing" | "completed" {
  const now = new Date();
  if (now < startDate) return "upcoming";
  if (now >= startDate && now <= endDate) return "ongoing";
  return "completed";
}

router.get("/shifts", requireAuth, requireNotBlacklisted, async (req: any, res) => {
  try {
    const { eventId, status } = req.query;
    const isAdmin = req.session.role === "admin";

    const shiftsData = await db
      .select({
        id: shiftsTable.id,
        eventId: shiftsTable.eventId,
        role: shiftsTable.role,
        description: shiftsTable.description,
        startTime: shiftsTable.startTime,
        endTime: shiftsTable.endTime,
        hourlyRate: shiftsTable.hourlyRate,
        totalPay: shiftsTable.totalPay,
        spotsTotal: shiftsTable.spotsTotal,
        spotsFilled: shiftsTable.spotsFilled,
        status: shiftsTable.status,
        requirements: shiftsTable.requirements,
        genderPreference: shiftsTable.genderPreference,
        experienceRequired: shiftsTable.experienceRequired,
        paymentType: shiftsTable.paymentType,
        dressCode: shiftsTable.dressCode,
        groomingInstructions: shiftsTable.groomingInstructions,
        applicationsOpen: shiftsTable.applicationsOpen,
        createdAt: shiftsTable.createdAt,
        eventTitle: eventsTable.title,
        eventLocation: eventsTable.location,
        eventCity: eventsTable.city,
        eventRole: eventsTable.role,
        eventGenderRequired: eventsTable.genderRequired,
        eventWorkTask: eventsTable.workTask,
        eventPayPerDay: eventsTable.payPerDay,
        eventPayFemale: eventsTable.payFemale,
        eventPayFemaleMax: eventsTable.payFemaleMax,
        eventPayMale: eventsTable.payMale,
        eventPayMaleMax: eventsTable.payMaleMax,
        eventPayFresher: eventsTable.payFresher,
        eventRoleConfigs: eventsTable.roleConfigs,
        eventTimings: eventsTable.timings,
        eventStartDate: eventsTable.startDate,
        eventEndDate: eventsTable.endDate,
        eventFoodProvided: eventsTable.foodProvided,
        eventMealsProvided: eventsTable.mealsProvided,
        eventIncentives: eventsTable.incentives,
        eventReferralReward: eventsTable.referralReward,
        eventDressCode: eventsTable.dressCode,
        eventDressCodeImage: eventsTable.dressCodeImage,
        eventImage: eventsTable.eventImage,
        eventStoredStatus: eventsTable.status,
      })
      .from(shiftsTable)
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id));

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));

    const myClaims = profile ? await db.select({
      shiftId: shiftClaimsTable.shiftId,
      status: shiftClaimsTable.status,
      appliedRoles: shiftClaimsTable.appliedRoles,
      assignedRole: shiftClaimsTable.assignedRole,
    }).from(shiftClaimsTable).where(eq(shiftClaimsTable.crewId, profile.id)) : [];

    let filtered = shiftsData;
    if (eventId) filtered = filtered.filter(s => s.eventId === parseInt(eventId as string));
    if (status) filtered = filtered.filter(s => s.status === status);

    if (!isAdmin) {
      filtered = filtered.filter(s => {
        if (s.eventStoredStatus === "cancelled") return false;
        const evStatus = eventAutoStatus(new Date(s.eventStartDate as any), new Date(s.eventEndDate as any));
        return evStatus === "upcoming" || evStatus === "ongoing";
      });
    }

    res.json(filtered.map(shift => {
      const myClaim = myClaims.find(c => c.shiftId === shift.id);
      return {
        ...formatShift(shift),
        claimedByMe: !!myClaim,
        myClaimStatus: myClaim?.status || null,
        myAppliedRoles: myClaim?.appliedRoles ? JSON.parse(myClaim.appliedRoles) : [],
        myAssignedRole: myClaim?.assignedRole || null,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/shifts", requireAdmin, async (req: any, res) => {
  try {
    const {
      eventId, role, description, startTime, endTime,
      payPerShift, hourlyRate,
      spotsTotal, requirements,
      genderPreference, experienceRequired, paymentType,
      dressCode, groomingInstructions, applicationsOpen,
    } = req.body;

    if (!eventId || !role || !startTime || !endTime || !spotsTotal) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    let finalTotalPay: string;
    let finalHourlyRate: string;

    if (payPerShift) {
      finalTotalPay = parseFloat(payPerShift).toFixed(2);
      finalHourlyRate = hours > 0 ? (parseFloat(payPerShift) / hours).toFixed(2) : "0";
    } else if (hourlyRate) {
      finalHourlyRate = parseFloat(hourlyRate).toFixed(2);
      finalTotalPay = (parseFloat(hourlyRate) * hours).toFixed(2);
    } else {
      finalTotalPay = "0";
      finalHourlyRate = "0";
    }

    const [shift] = await db.insert(shiftsTable).values({
      eventId: parseInt(eventId),
      role,
      description: description || null,
      startTime: start,
      endTime: end,
      hourlyRate: finalHourlyRate,
      totalPay: finalTotalPay,
      spotsTotal: parseInt(spotsTotal),
      requirements: requirements || null,
      genderPreference: genderPreference || null,
      experienceRequired: experienceRequired || null,
      paymentType: paymentType || null,
      dressCode: dressCode || null,
      groomingInstructions: groomingInstructions || null,
      applicationsOpen: applicationsOpen !== false,
    }).returning();

    await db.update(eventsTable).set({
      totalShifts: (await db.select().from(shiftsTable).where(eq(shiftsTable.eventId, parseInt(eventId)))).length,
      updatedAt: new Date(),
    }).where(eq(eventsTable.id, parseInt(eventId)));

    res.status(201).json({
      ...formatShift(shift),
      eventTitle: null,
      eventLocation: null,
      eventCity: null,
      claimedByMe: false,
      myClaimStatus: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/shifts/:id", requireAuth, requireNotBlacklisted, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [shift] = await db
      .select({
        id: shiftsTable.id,
        eventId: shiftsTable.eventId,
        role: shiftsTable.role,
        description: shiftsTable.description,
        startTime: shiftsTable.startTime,
        endTime: shiftsTable.endTime,
        hourlyRate: shiftsTable.hourlyRate,
        totalPay: shiftsTable.totalPay,
        spotsTotal: shiftsTable.spotsTotal,
        spotsFilled: shiftsTable.spotsFilled,
        status: shiftsTable.status,
        requirements: shiftsTable.requirements,
        genderPreference: shiftsTable.genderPreference,
        experienceRequired: shiftsTable.experienceRequired,
        paymentType: shiftsTable.paymentType,
        dressCode: shiftsTable.dressCode,
        groomingInstructions: shiftsTable.groomingInstructions,
        applicationsOpen: shiftsTable.applicationsOpen,
        createdAt: shiftsTable.createdAt,
        eventTitle: eventsTable.title,
        eventLocation: eventsTable.location,
        eventCity: eventsTable.city,
        eventRole: eventsTable.role,
        eventGenderRequired: eventsTable.genderRequired,
        eventWorkTask: eventsTable.workTask,
        eventPayPerDay: eventsTable.payPerDay,
        eventPayFemale: eventsTable.payFemale,
        eventPayFemaleMax: eventsTable.payFemaleMax,
        eventPayMale: eventsTable.payMale,
        eventPayMaleMax: eventsTable.payMaleMax,
        eventPayFresher: eventsTable.payFresher,
        eventRoleConfigs: eventsTable.roleConfigs,
        eventTimings: eventsTable.timings,
        eventStartDate: eventsTable.startDate,
        eventEndDate: eventsTable.endDate,
        eventFoodProvided: eventsTable.foodProvided,
        eventMealsProvided: eventsTable.mealsProvided,
        eventIncentives: eventsTable.incentives,
        eventReferralReward: eventsTable.referralReward,
        eventDressCode: eventsTable.dressCode,
        eventDressCodeImage: eventsTable.dressCodeImage,
        eventImage: eventsTable.eventImage,
        eventDescription: eventsTable.description,
        eventLatitude: eventsTable.latitude,
        eventLongitude: eventsTable.longitude,
        eventExpectedCheckIn:  eventsTable.expectedCheckIn,
        eventExpectedCheckOut: eventsTable.expectedCheckOut,
      })
      .from(shiftsTable)
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .where(eq(shiftsTable.id, id));

    if (!shift) return res.status(404).json({ error: "Shift not found" });

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    const myClaim = profile
      ? await db.select().from(shiftClaimsTable).where(and(eq(shiftClaimsTable.shiftId, id), eq(shiftClaimsTable.crewId, profile.id)))
      : [];

    const claim = myClaim[0] ?? null;
    // Compute statuses dynamically so admin edits to expected times are reflected immediately.
    const myCheckInStatus  = computeCheckInStatus(claim?.checkedInAt,  shift.eventExpectedCheckIn,  shift.eventStartDate);
    const myCheckOutStatus = computeCheckOutStatus(claim?.checkOutAt, shift.eventExpectedCheckOut, shift.eventStartDate);

    res.json({
      ...formatShift(shift),
      eventExpectedCheckIn:  shift.eventExpectedCheckIn,
      eventExpectedCheckOut: shift.eventExpectedCheckOut,
      claimedByMe: myClaim.length > 0,
      myClaimStatus:    claim?.status           || null,
      myCheckedInAt:    claim?.checkedInAt      || null,
      myAttendanceDate: claim?.attendanceDate   || null,
      myApprovedAt:     claim?.approvedAt       || null,
      myClaimId:        claim?.id               || null,
      myCheckInStatus,
      myCheckOutAt:     claim?.checkOutAt       || null,
      myCheckOutStatus,
      myAppliedRoles:   claim?.appliedRoles ? JSON.parse(claim.appliedRoles) : [],
      myAssignedRole:   claim?.assignedRole || null,
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.post("/shifts/:id/checkin", requireAuth, async (req: any, res) => {
  try {
    const shiftId = parseInt(req.params.id);
    const { lat, lng, selfieImage } = req.body;

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const [claim] = await db.select().from(shiftClaimsTable).where(
      and(eq(shiftClaimsTable.shiftId, shiftId), eq(shiftClaimsTable.crewId, profile.id), eq(shiftClaimsTable.status, "approved"))
    );
    if (!claim) return res.status(404).json({ error: "No approved claim found for this shift" });
    if (claim.checkedInAt) return res.status(400).json({ error: "Already checked in" });

    // Fetch shift + event for validations
    const [shiftRow] = await db
      .select({
        startTime: shiftsTable.startTime,
        eventLatitude: eventsTable.latitude,
        eventLongitude: eventsTable.longitude,
        eventExpectedCheckIn: eventsTable.expectedCheckIn,
        eventStartDate: eventsTable.startDate,
      })
      .from(shiftsTable)
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .where(eq(shiftsTable.id, shiftId));

    if (!shiftRow) return res.status(404).json({ error: "Shift not found" });

    const now = new Date();
    // Compute status by comparing actual check-in with expected check-in time (24-hour IST).
    const checkInStatus = computeCheckInStatus(now, shiftRow.eventExpectedCheckIn, shiftRow.eventStartDate) ?? "on-time";

    // Compute distance from event (meters) — warn-only, never block
    let computedDistance: number | null = null;
    if (shiftRow.eventLatitude && shiftRow.eventLongitude && lat && lng) {
      computedDistance = Math.round(haversineMeters(
        parseFloat(shiftRow.eventLatitude), parseFloat(shiftRow.eventLongitude),
        parseFloat(lat), parseFloat(lng)
      ));
      console.log(`[attendance] shifts checkin claim ${claim.id}: distance=${computedDistance}m`);
    }

    const attendanceDate = getISTDate(now);

    const [updated] = await db.update(shiftClaimsTable)
      .set({
        checkedInAt: now,
        attendanceDate,
        checkInLat: lat ? lat.toString() : null,
        checkInLng: lng ? lng.toString() : null,
        selfieImage: selfieImage || null,
        checkInStatus,
        distanceFromEvent: computedDistance != null ? String(computedDistance) : null,
      })
      .where(eq(shiftClaimsTable.id, claim.id))
      .returning();

    res.json({ success: true, checkedInAt: updated.checkedInAt, attendanceDate, checkInStatus, distanceFromEvent: computedDistance });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/shifts/:id/checkout", requireAuth, async (req: any, res) => {
  try {
    const shiftId = parseInt(req.params.id);

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const [claim] = await db.select().from(shiftClaimsTable).where(
      and(eq(shiftClaimsTable.shiftId, shiftId), eq(shiftClaimsTable.crewId, profile.id), eq(shiftClaimsTable.status, "approved"))
    );
    if (!claim) return res.status(404).json({ error: "No approved claim found for this shift" });
    if (!claim.checkedInAt) return res.status(400).json({ error: "You must check in before checking out" });
    if (claim.checkOutAt) return res.status(400).json({ error: "Already checked out" });

    // Resolve event to compute check-out status dynamically.
    const [shiftRow2] = await db
      .select({ eventExpectedCheckOut: eventsTable.expectedCheckOut, eventStartDate: eventsTable.startDate })
      .from(shiftsTable)
      .innerJoin(eventsTable, eq(shiftsTable.eventId, eventsTable.id))
      .where(eq(shiftsTable.id, shiftId));

    const now = new Date();
    const checkOutStatus = shiftRow2
      ? computeCheckOutStatus(now, shiftRow2.eventExpectedCheckOut, shiftRow2.eventStartDate)
      : null;

    const [updated] = await db.update(shiftClaimsTable)
      .set({ checkOutAt: now, checkOutStatus: checkOutStatus ?? null, updatedAt: now })
      .where(eq(shiftClaimsTable.id, claim.id))
      .returning();

    // ── Auto-credit referral reward on successful event completion ─────────
    try {
      // Resolve event ID for this shift
      const [shiftEvt] = await db.select({ eventId: shiftsTable.eventId })
        .from(shiftsTable).where(eq(shiftsTable.id, shiftId));

      if (shiftEvt?.eventId) {
        const [referral] = await db.select().from(referralsTable)
          .where(and(
            eq(referralsTable.referredUserId, req.session.userId),
            eq(referralsTable.eventId, shiftEvt.eventId),
          ));

        // Credit only if selected (not yet completed) and crew actually checked in
        if (referral && referral.status === "selected" && claim.checkedInAt) {
          const reward = referral.rewardAmount ? parseFloat(referral.rewardAmount as string) : 100;

          await db.update(referralsTable)
            .set({ status: "confirmed", rewardPaid: "yes", updatedAt: now })
            .where(eq(referralsTable.id, referral.id));

          await db.update(crewProfilesTable)
            .set({
              walletBalance: sql`${crewProfilesTable.walletBalance} + ${reward}`,
              updatedAt: now,
            })
            .where(eq(crewProfilesTable.id, referral.referrerId));

          console.log(`[referral] Reward ₹${reward} credited to crew_profile ${referral.referrerId} for referral ${referral.id}`);
        }
      }
    } catch (refErr) {
      console.error("[referral] checkout credit error:", refErr);
    }

    res.json({ success: true, checkOutAt: updated.checkOutAt, checkOutStatus: updated.checkOutStatus });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/shifts/:id", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      role, description, startTime, endTime,
      payPerShift, hourlyRate,
      spotsTotal, requirements, eventId,
      genderPreference, experienceRequired, paymentType,
      dressCode, groomingInstructions, applicationsOpen,
    } = req.body;

    let finalTotalPay: string | undefined;
    let finalHourlyRate: string | undefined;

    if (payPerShift !== undefined && startTime && endTime) {
      const hours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
      finalTotalPay = parseFloat(payPerShift).toFixed(2);
      finalHourlyRate = hours > 0 ? (parseFloat(payPerShift) / hours).toFixed(2) : "0";
    } else if (hourlyRate !== undefined && startTime && endTime) {
      const hours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
      finalHourlyRate = parseFloat(hourlyRate).toFixed(2);
      finalTotalPay = (parseFloat(hourlyRate) * hours).toFixed(2);
    }

    const [shift] = await db.update(shiftsTable).set({
      ...(role && { role }),
      ...(description !== undefined && { description }),
      ...(startTime && { startTime: new Date(startTime) }),
      ...(endTime && { endTime: new Date(endTime) }),
      ...(finalHourlyRate !== undefined && { hourlyRate: finalHourlyRate }),
      ...(finalTotalPay !== undefined && { totalPay: finalTotalPay }),
      ...(spotsTotal && { spotsTotal: parseInt(spotsTotal) }),
      ...(requirements !== undefined && { requirements }),
      ...(eventId && { eventId: parseInt(eventId) }),
      ...(genderPreference !== undefined && { genderPreference }),
      ...(experienceRequired !== undefined && { experienceRequired }),
      ...(paymentType !== undefined && { paymentType }),
      ...(dressCode !== undefined && { dressCode }),
      ...(groomingInstructions !== undefined && { groomingInstructions }),
      ...(applicationsOpen !== undefined && { applicationsOpen }),
      updatedAt: new Date(),
    }).where(eq(shiftsTable.id, id)).returning();

    if (!shift) return res.status(404).json({ error: "Shift not found" });
    res.json({
      ...formatShift(shift),
      eventTitle: null,
      eventLocation: null,
      eventCity: null,
      claimedByMe: false,
      myClaimStatus: null,
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/shifts/:id/toggle-applications", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [current] = await db.select({ applicationsOpen: shiftsTable.applicationsOpen }).from(shiftsTable).where(eq(shiftsTable.id, id));
    if (!current) return res.status(404).json({ error: "Shift not found" });

    const [shift] = await db.update(shiftsTable).set({
      applicationsOpen: !current.applicationsOpen,
      updatedAt: new Date(),
    }).where(eq(shiftsTable.id, id)).returning();

    res.json({ applicationsOpen: shift.applicationsOpen });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/shifts/:id", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(shiftClaimsTable).where(eq(shiftClaimsTable.shiftId, id));
    await db.delete(shiftsTable).where(eq(shiftsTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /shifts/:id error:", err?.message || err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/shifts/:id/claim", requireAuth, requireNotBlacklisted, async (req: any, res) => {
  try {
    const shiftId = parseInt(req.params.id);

    console.log("[claim] User ID:", req.session.userId, "| Role:", req.session.role);

    if (req.session.role === "admin") {
      return res.status(403).json({ error: "Admins cannot apply for shifts." });
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (!user) return res.status(401).json({ error: "User not found. Please log in again." });

    if (user.status !== "approved" && user.status !== "active") {
      return res.status(403).json({ error: "Your account must be approved before claiming shifts" });
    }

    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    console.log("[claim] Crew profile:", profile ? `id=${profile.id}` : "NOT FOUND");
    if (!profile) return res.status(404).json({ error: "Please complete your profile first. Contact support if this persists." });

    const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, shiftId));
    if (!shift) return res.status(404).json({ error: "Shift not found" });
    if (shift.status !== "open") return res.status(400).json({ error: "Shift is not open for claiming" });
    if (!shift.applicationsOpen) return res.status(400).json({ error: "Applications for this shift are closed" });
    if (shift.spotsFilled >= shift.spotsTotal) return res.status(400).json({ error: "Shift is full" });

    // Gender eligibility check
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, shift.eventId));
    if (event?.genderRequired && event.genderRequired !== "both" && event.genderRequired !== "Both" && event.genderRequired !== "any") {
      const profileGender = (profile.gender || "").toLowerCase();
      const requiredGender = event.genderRequired.toLowerCase();
      if (profileGender && profileGender !== requiredGender) {
        return res.status(403).json({ error: `This event is only open for ${event.genderRequired} applicants.` });
      }
    }

    const existing = await db.select().from(shiftClaimsTable)
      .where(and(eq(shiftClaimsTable.shiftId, shiftId), eq(shiftClaimsTable.crewId, profile.id)));
    if (existing.length > 0) return res.status(400).json({ error: "You already claimed this shift" });

    const { appliedRoles } = req.body;
    if (appliedRoles && (!Array.isArray(appliedRoles) || appliedRoles.length > 2)) {
      return res.status(400).json({ error: "You can select at most 2 roles." });
    }
    const appliedRolesJson = appliedRoles && appliedRoles.length > 0 ? JSON.stringify(appliedRoles) : null;

    const [claim] = await db.insert(shiftClaimsTable).values({
      shiftId,
      crewId: profile.id,
      status: "pending",
      appliedRoles: appliedRolesJson,
    }).returning();

    res.status(201).json({
      id: claim.id,
      shiftId: claim.shiftId,
      crewId: claim.crewId,
      crewName: user.name,
      crewEmail: user.email,
      crewPhone: profile.phone,
      shiftRole: shift.role,
      eventTitle: event?.title || "",
      eventLocation: event?.location || "",
      shiftStartTime: shift.startTime,
      shiftEndTime: shift.endTime,
      totalPay: parseFloat(shift.totalPay || "0"),
      status: claim.status,
      claimedAt: claim.claimedAt,
      approvedAt: claim.approvedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/shifts/:id/unclaim", requireAuth, async (req: any, res) => {
  try {
    const shiftId = parseInt(req.params.id);
    const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    await db.delete(shiftClaimsTable)
      .where(and(eq(shiftClaimsTable.shiftId, shiftId), eq(shiftClaimsTable.crewId, profile.id)));

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
