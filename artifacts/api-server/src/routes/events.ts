import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eventsTable, shiftsTable, shiftClaimsTable, paymentsTable, usersTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getISTDate } from "../lib/attendance-utils";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

function autoStatus(startDate: Date, endDate: Date): "upcoming" | "ongoing" | "completed" {
  const now = new Date();
  if (now < startDate) return "upcoming";
  if (now >= startDate && now <= endDate) return "ongoing";
  return "completed";
}

function calcDays(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

/** Create (or overwrite) the auto-managed shift for an event. */
async function upsertEventShift(event: {
  id: number;
  role: string | null;
  startDate: Date;
  endDate: Date;
  payPerDay: string | null;
  genderRequired: string | null;
  totalSlots?: number;
}) {
  const days = calcDays(event.startDate, event.endDate);
  const pay = event.payPerDay ? parseFloat(event.payPerDay) : 0;
  const totalPay = (pay * days).toFixed(2);
  const spotsTotal = event.totalSlots ?? 10;

  const existing = await db
    .select({ id: shiftsTable.id })
    .from(shiftsTable)
    .where(eq(shiftsTable.eventId, event.id));

  if (existing.length === 0) {
    // Auto-create the first shift for this event
    await db.insert(shiftsTable).values({
      eventId: event.id,
      role: event.role || "Staff",
      startTime: event.startDate,
      endTime: event.endDate,
      totalPay,
      hourlyRate: "0",
      spotsTotal,
      genderPreference: event.genderRequired || null,
      applicationsOpen: true,
      status: "open",
    });
    console.log(`[events] Auto-created shift for event ${event.id} | totalPay=₹${totalPay} | days=${days} | slots=${spotsTotal}`);
  } else {
    // Update existing auto-shift (preserve spotsFilled, update spotsTotal)
    await db.update(shiftsTable).set({
      role: event.role || "Staff",
      startTime: event.startDate,
      endTime: event.endDate,
      totalPay,
      spotsTotal,
      genderPreference: event.genderRequired || null,
      updatedAt: new Date(),
    }).where(eq(shiftsTable.eventId, event.id));
    console.log(`[events] Updated shift for event ${event.id} | totalPay=₹${totalPay} | days=${days} | slots=${spotsTotal}`);
  }
}

// Rate-limit tracker for permanent delete attempts (in-memory, per admin user)
const deleteAttempts = new Map<number, { count: number; resetAt: number }>();
const MAX_DELETE_ATTEMPTS = 3;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

async function auditLog(action_type: string, event_id: number | null, event_name: string | null, admin_email: string | null, detail?: string) {
  try {
    await db.execute(sql`
      INSERT INTO activity_logs (action_type, event_id, event_name, admin_email, detail, created_at)
      VALUES (${action_type}, ${event_id}, ${event_name}, ${admin_email}, ${detail ?? null}, NOW())
    `);
  } catch (e) {
    console.error("[auditLog] Failed to write audit log:", e);
  }
}

router.get("/events", requireAuth, async (req: any, res) => {
  try {
    const { status } = req.query;
    const isAdmin = req.session.role === "admin";
    const now = new Date();
    const events = await db.select().from(eventsTable);
    const toAutoLock: number[] = [];

    const withAutoStatus = events
      .filter(e => e.status !== "draft" && e.status !== "archived")
      .map(e => {
        const computedStatus = e.status === "cancelled" ? "cancelled" : autoStatus(new Date(e.startDate), new Date(e.endDate));
        // Auto-lock completed events
        if (computedStatus === "completed" && !e.isLocked) {
          toAutoLock.push(e.id);
          return { ...e, status: computedStatus, isLocked: true, lockedReason: "completed", lockedAt: now };
        }
        return { ...e, status: computedStatus };
      });

    // Fire-and-forget: persist auto-lock for newly completed events
    if (toAutoLock.length > 0) {
      (async () => {
        for (const id of toAutoLock) {
          try {
            await db.update(eventsTable)
              .set({ isLocked: true, lockedReason: "completed", lockedAt: now })
              .where(eq(eventsTable.id, id));
            await auditLog("LOCK", id, null, "system", "Auto-locked: event completed");
          } catch {}
        }
      })();
    }

    let filtered = status ? withAutoStatus.filter(e => e.status === status) : withAutoStatus;
    if (!isAdmin) {
      filtered = filtered.filter(e => e.status === "upcoming" || e.status === "ongoing");
      console.log(`[events] Crew GET /events → returning ${filtered.length} upcoming/ongoing events`);
    }
    res.json(filtered);
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("[events] GET /events error:", msg);
    res.status(500).json({ error: msg });
  }
});

router.get("/events/archived", requireAdmin, async (req: any, res) => {
  try {
    const archived = await db.select().from(eventsTable).where(eq(eventsTable.status, sql`'archived'::event_status`));
    res.json(archived);
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("[events] GET /events/archived error:", msg);
    res.status(500).json({ error: msg });
  }
});

router.get("/events/drafts", requireAdmin, async (_req, res) => {
  try {
    const drafts = await db.select().from(eventsTable).where(eq(eventsTable.status, "draft"));
    res.json(drafts);
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("[events] GET /events/drafts error:", msg);
    res.status(500).json({ error: msg });
  }
});

router.post("/events", requireAdmin, async (req: any, res) => {
  console.log("[events] REQUEST BODY:", JSON.stringify(req.body, null, 2));
  try {
    const { saveAsDraft, title, description, city, location, latitude, longitude, startDate, endDate, clientName, timings, dressCode, dressCodeImage, foodProvided, mealsProvided, incentives, referralReward, referralMessage, expectedCheckIn, expectedCheckOut, lateThresholdMinutes, breakWindowStart, breakWindowEnd, allowedBreakMinutes } = req.body;
    let { role, genderRequired, workTask, payPerDay, payFemale, payMale, payFresher, roleConfigs: roleConfigsRaw, totalSlots } = req.body;
    let payMaleMax: string | null = null;
    let payFemaleMax: string | null = null;

    // Parse a range string like "1000-4000" or "1500" into { min, max }
    const parsePayRange = (val: any): { min: string | null; max: string | null } => {
      if (!val && val !== 0) return { min: null, max: null };
      const s = String(val).replace(/[–—]/g, "-").trim();
      const parts = s.split("-").map(p => p.trim());
      const min = parseFloat(parts[0]);
      const max = parts[1] ? parseFloat(parts[1]) : NaN;
      return {
        min: !isNaN(min) ? String(min) : null,
        max: !isNaN(max) ? String(max) : null,
      };
    };

    // Derive legacy fields from roleConfigs when provided
    if (roleConfigsRaw) {
      try {
        const configs: any[] = typeof roleConfigsRaw === "string" ? JSON.parse(roleConfigsRaw) : roleConfigsRaw;
        if (configs.length > 0) {
          const first = configs[0];
          if (!role) role = first.role;
          if (!workTask) workTask = first.task;
          const genders = [...new Set(configs.map((c: any) => c.gender))];
          if (!genderRequired) genderRequired = genders.length === 1 ? genders[0] : "both";
          const maleConfig = configs.find((c: any) => c.gender === "male");
          const femaleConfig = configs.find((c: any) => c.gender === "female");
          const bothConfig = configs.find((c: any) => c.gender === "both");
          if (maleConfig) {
            const r = parsePayRange(maleConfig.payMale ?? maleConfig.minPay ?? maleConfig.pay);
            payMale = r.min; payMaleMax = r.max;
          }
          if (femaleConfig) {
            const r = parsePayRange(femaleConfig.payFemale ?? femaleConfig.minPay ?? femaleConfig.pay);
            payFemale = r.min; payFemaleMax = r.max;
          }
          if (bothConfig) {
            const rm = parsePayRange(bothConfig.payMale ?? bothConfig.minPay ?? bothConfig.pay);
            const rf = parsePayRange(bothConfig.payFemale ?? bothConfig.minPay ?? bothConfig.pay);
            payMale = rm.min; payMaleMax = rm.max;
            payFemale = rf.min; payFemaleMax = rf.max;
          }
          if (!payPerDay) payPerDay = payMale ?? payFemale ?? first.minPay ?? first.pay ?? 0;
          // If per-role slots exist, sum them to get totalSlots (authoritative source)
          const hasPerRoleSlots = configs.some((c: any) => c.slots != null && parseInt(c.slots) > 0);
          if (hasPerRoleSlots) {
            const summedSlots = configs.reduce((acc: number, c: any) => acc + (parseInt(c.slots) || 0), 0);
            if (summedSlots > 0) totalSlots = summedSlots;
          }
        }
        roleConfigsRaw = JSON.stringify(configs);
      } catch {}
    }

    if (saveAsDraft) {
      // Draft — only title required, dates/location optional
      if (!title) return res.status(400).json({ error: "Title is required to save a draft" });
      const draftStart = startDate ? new Date(startDate) : new Date();
      const draftEnd   = endDate   ? new Date(endDate)   : new Date();
      const slots = totalSlots ? parseInt(totalSlots) : 10;

      // Use raw SQL to insert draft — bypasses Drizzle's TypeScript enum validation
      // which may lag behind newly-added PostgreSQL enum values.
      const result = await db.execute(sql`
        INSERT INTO events (
          title, description, city, location, start_date, end_date,
          status, client_name, role, gender_required, work_task,
          pay_per_day, pay_female, pay_female_max, pay_male, pay_male_max, pay_fresher,
          timings, dress_code, dress_code_image,
          food_provided, meals_provided, incentives, referral_reward, referral_message,
          total_slots, latitude, longitude,
          expected_check_in, expected_check_out, late_threshold_minutes,
          break_window_start, break_window_end, allowed_break_minutes,
          role_configs
        ) VALUES (
          ${title},
          ${description || null},
          ${city || null},
          ${location || "TBD"},
          ${draftStart},
          ${draftEnd},
          'draft'::event_status,
          ${clientName || null},
          ${role || null},
          ${genderRequired || "both"},
          ${workTask || null},
          ${payPerDay ? payPerDay.toString() : null},
          ${payFemale || null},
          ${payFemaleMax || null},
          ${payMale || null},
          ${payMaleMax || null},
          ${payFresher ? payFresher.toString() : null},
          ${timings || null},
          ${dressCode || null},
          ${dressCodeImage || null},
          ${!!foodProvided},
          ${foodProvided ? (mealsProvided || null) : null},
          ${incentives || null},
          ${referralReward ? referralReward.toString() : null},
          ${referralMessage || null},
          ${slots},
          ${latitude || null},
          ${longitude || null},
          ${expectedCheckIn || null},
          ${expectedCheckOut || null},
          ${lateThresholdMinutes != null ? (parseInt(lateThresholdMinutes) || 15) : 15},
          ${breakWindowStart || null},
          ${breakWindowEnd || null},
          ${allowedBreakMinutes != null ? parseInt(allowedBreakMinutes) || null : null},
          ${roleConfigsRaw || null}
        )
        RETURNING *
      `) as any;

      const draft = result.rows?.[0] ?? result[0];
      console.log(`[events] Draft saved: id=${draft?.id} title="${title}"`);
      return res.status(201).json(draft);
    }

    // Normal event creation
    if (!title || !location || !startDate || !endDate) {
      return res.status(400).json({ error: "Title, location, startDate, endDate required" });
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    const status = autoStatus(start, end);
    const slots = totalSlots ? parseInt(totalSlots) : 10;

    console.log(`[events] Creating event: "${title}" | startDate=${start.toISOString()} | endDate=${end.toISOString()} | status=${status} | foodProvided=${!!foodProvided} | mealsProvided=${mealsProvided || null} | totalSlots=${slots}`);
    console.log(`[events] Pay values: payMale=${payMale} payMaleMax=${payMaleMax} payFemale=${payFemale} payFemaleMax=${payFemaleMax} payPerDay=${payPerDay}`);
    console.log(`[events] Attendance: checkIn=${expectedCheckIn} checkOut=${expectedCheckOut} lateThresholdMinutes=${lateThresholdMinutes}`);

    const [event] = await db.insert(eventsTable).values({
      title,
      description: description || null,
      city: city || null,
      location,
      startDate: start,
      endDate: end,
      clientName: clientName || null,
      role: role || null,
      genderRequired: genderRequired || null,
      workTask: workTask || null,
      payPerDay: payPerDay ? payPerDay.toString() : null,
      payFemale: payFemale || null,
      payFemaleMax: payFemaleMax || null,
      payMale: payMale || null,
      payMaleMax: payMaleMax || null,
      payFresher: payFresher ? payFresher.toString() : null,
      roleConfigs: roleConfigsRaw || null,
      timings: timings || null,
      dressCode: dressCode || null,
      dressCodeImage: dressCodeImage || null,
      foodProvided: !!foodProvided,
      mealsProvided: foodProvided ? (mealsProvided || null) : null,
      incentives: incentives || null,
      referralReward: referralReward ? referralReward.toString() : null,
      referralMessage: referralMessage || null,
      totalSlots: slots,
      latitude: latitude || null,
      longitude: longitude || null,
      expectedCheckIn: expectedCheckIn || null,
      expectedCheckOut: expectedCheckOut || null,
      lateThresholdMinutes: lateThresholdMinutes != null ? (parseInt(lateThresholdMinutes) || 15) : 15,
      breakWindowStart: breakWindowStart || null,
      breakWindowEnd: breakWindowEnd || null,
      allowedBreakMinutes: allowedBreakMinutes != null ? parseInt(allowedBreakMinutes) || null : null,
      status,
    }).returning();

    // Auto-create a default open shift so crew can immediately see this event
    await upsertEventShift({ id: event.id, role: event.role, startDate: start, endDate: end, payPerDay: event.payPerDay, genderRequired: event.genderRequired, totalSlots: slots });

    console.log(`[events] Event created: id=${event.id} status=${status}`);
    res.status(201).json(event);
  } catch (error: any) {
    const cause = error?.cause;
    const msg = cause?.message || error?.message || JSON.stringify(error) || "Server error";

    console.error("EVENT CREATE ERROR:", error);
    console.error("STACK:", error?.stack);

    // Write to log file for production environments (e.g. Hostinger) where stdout may not be visible
    try {
      const { appendFileSync, mkdirSync } = await import("fs");
      const { join } = await import("path");
      const logDir = join(process.cwd(), "logs");
      mkdirSync(logDir, { recursive: true });
      const line = `\n[${new Date().toISOString()}] EVENT CREATE ERROR\nMESSAGE: ${msg}\nBODY: ${JSON.stringify(req.body)}\nSTACK: ${error?.stack}\n---`;
      appendFileSync(join(logDir, "event-errors.log"), line);
    } catch {}

    res.status(500).json({ message: "Server error", error: msg });
  }
});

router.get("/events/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json({
      ...event,
      status: event.status === "cancelled" ? "cancelled" : autoStatus(new Date(event.startDate), new Date(event.endDate)),
    });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("[events] GET /events/:id error:", msg);
    res.status(500).json({ error: msg });
  }
});

router.put("/events/:id", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { saveAsDraft, title, description, city, location, startDate, endDate, clientName, status } = req.body;

    // Detect date change — if the IST calendar date changes, all attendance must be wiped
    // (only relevant for non-draft events)
    let attendanceCleared = 0;
    if (startDate && !saveAsDraft) {
      const [existing] = await db.select({ startDate: eventsTable.startDate }).from(eventsTable).where(eq(eventsTable.id, id));
      if (existing) {
        const oldISTDate = getISTDate(new Date(existing.startDate));
        const newISTDate = getISTDate(new Date(startDate));
        if (oldISTDate !== newISTDate) {
          // Date changed — find all shift_claims for this event and wipe attendance
          const eventShifts = await db.select({ id: shiftsTable.id }).from(shiftsTable).where(eq(shiftsTable.eventId, id));
          if (eventShifts.length > 0) {
            const shiftIds = eventShifts.map(s => s.id);
            await db.update(shiftClaimsTable)
              .set({
                checkedInAt: null,
                attendanceDate: null,
                checkInStatus: null,
                checkInLat: null,
                checkInLng: null,
                selfieImage: null,
                checkOutAt: null,
                checkOutStatus: null,
                checkOutLat: null,
                checkOutLng: null,
                checkOutPhotoUrl: null,
                breakStartAt: null,
                breakEndAt: null,
                totalBreakMinutes: 0,
                breakExceeded: false,
                isAbsent: false,
                attendanceApproved: null,
                approvedPay: null,
                updatedAt: new Date(),
              })
              .where(inArray(shiftClaimsTable.shiftId, shiftIds));
            attendanceCleared = shiftIds.length;
            console.log(`[events] Date changed ${oldISTDate} → ${newISTDate} for event ${id} — cleared attendance for ${attendanceCleared} shift(s)`);
          }
        }
      }
    }

    // Compute status — draft stays draft; publishing auto-computes from dates
    let computedStatus: string | undefined = status;
    if (saveAsDraft) {
      computedStatus = "draft";
    } else if (startDate && endDate && status !== "cancelled") {
      computedStatus = autoStatus(new Date(startDate), new Date(endDate));
    }

    let { role, genderRequired, workTask, payPerDay, payFemale, payMale, payFresher, roleConfigs: putRoleConfigsRaw, timings, dressCode, dressCodeImage, foodProvided, mealsProvided, incentives, referralReward, referralMessage, totalSlots, latitude, longitude, expectedCheckIn, expectedCheckOut, lateThresholdMinutes, breakWindowStart, breakWindowEnd, allowedBreakMinutes } = req.body;
    let putPayMaleMax: string | null = null;
    let putPayFemaleMax: string | null = null;

    const parsePayRangePut = (val: any): { min: string | null; max: string | null } => {
      if (!val && val !== 0) return { min: null, max: null };
      const s = String(val).replace(/[–—]/g, "-").trim();
      const parts = s.split("-").map((p: string) => p.trim());
      const min = parseFloat(parts[0]);
      const max = parts[1] ? parseFloat(parts[1]) : NaN;
      return { min: !isNaN(min) ? String(min) : null, max: !isNaN(max) ? String(max) : null };
    };

    // Derive fields from roleConfigs when provided
    if (putRoleConfigsRaw) {
      try {
        const configs: any[] = typeof putRoleConfigsRaw === "string" ? JSON.parse(putRoleConfigsRaw) : putRoleConfigsRaw;
        if (configs.length > 0) {
          const first = configs[0];
          role = first.role;
          workTask = first.task;
          const genders = [...new Set(configs.map((c: any) => c.gender))];
          genderRequired = genders.length === 1 ? genders[0] : "both";
          const maleConfig = configs.find((c: any) => c.gender === "male");
          const femaleConfig = configs.find((c: any) => c.gender === "female");
          const bothConfig = configs.find((c: any) => c.gender === "both");
          if (maleConfig) {
            const r = parsePayRangePut(maleConfig.payMale ?? maleConfig.minPay ?? maleConfig.pay);
            payMale = r.min; putPayMaleMax = r.max;
          } else { payMale = null; putPayMaleMax = null; }
          if (femaleConfig) {
            const r = parsePayRangePut(femaleConfig.payFemale ?? femaleConfig.minPay ?? femaleConfig.pay);
            payFemale = r.min; putPayFemaleMax = r.max;
          } else { payFemale = null; putPayFemaleMax = null; }
          if (bothConfig) {
            const rm = parsePayRangePut(bothConfig.payMale ?? bothConfig.minPay ?? bothConfig.pay);
            const rf = parsePayRangePut(bothConfig.payFemale ?? bothConfig.minPay ?? bothConfig.pay);
            payMale = rm.min; putPayMaleMax = rm.max;
            payFemale = rf.min; putPayFemaleMax = rf.max;
          }
          payPerDay = payMale ?? payFemale ?? first.minPay ?? first.pay ?? 0;
          // If per-role slots exist, sum them to get totalSlots (authoritative source)
          const hasPerRoleSlots = configs.some((c: any) => c.slots != null && parseInt(c.slots) > 0);
          if (hasPerRoleSlots) {
            const summedSlots = configs.reduce((acc: number, c: any) => acc + (parseInt(c.slots) || 0), 0);
            if (summedSlots > 0) totalSlots = summedSlots;
          }
        }
        putRoleConfigsRaw = JSON.stringify(configs);
      } catch {}
    }

    const foodBool = foodProvided !== undefined ? !!foodProvided : undefined;
    const [event] = await db.update(eventsTable).set({
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(city !== undefined && { city }),
      ...(location && { location }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate && { endDate: new Date(endDate) }),
      ...(clientName !== undefined && { clientName }),
      ...(computedStatus && { status: sql`${computedStatus}::event_status` as any }),
      ...(role !== undefined && { role }),
      ...(genderRequired !== undefined && { genderRequired }),
      ...(workTask !== undefined && { workTask }),
      ...(payPerDay !== undefined && { payPerDay: payPerDay ? payPerDay.toString() : null }),
      ...(payFemale !== undefined && { payFemale: payFemale || null }),
      ...(putPayFemaleMax !== undefined && { payFemaleMax: putPayFemaleMax || null }),
      ...(payMale !== undefined && { payMale: payMale || null }),
      ...(putPayMaleMax !== undefined && { payMaleMax: putPayMaleMax || null }),
      ...(payFresher !== undefined && { payFresher: payFresher ? payFresher.toString() : null }),
      ...(putRoleConfigsRaw !== undefined && { roleConfigs: putRoleConfigsRaw || null }),
      ...(timings !== undefined && { timings }),
      ...(dressCode !== undefined && { dressCode: dressCode || null }),
      ...(dressCodeImage !== undefined && { dressCodeImage: dressCodeImage || null }),
      ...(foodBool !== undefined && { foodProvided: foodBool }),
      ...(foodBool !== undefined && { mealsProvided: foodBool ? (mealsProvided || null) : null }),
      ...(incentives !== undefined && { incentives: incentives || null }),
      ...(referralReward !== undefined && { referralReward: referralReward ? referralReward.toString() : null }),
      ...(referralMessage !== undefined && { referralMessage: referralMessage || null }),
      ...(totalSlots !== undefined && { totalSlots: parseInt(totalSlots) || 10 }),
      ...(latitude !== undefined && { latitude: latitude || null }),
      ...(longitude !== undefined && { longitude: longitude || null }),
      ...(expectedCheckIn !== undefined && { expectedCheckIn: expectedCheckIn || null }),
      ...(expectedCheckOut !== undefined && { expectedCheckOut: expectedCheckOut || null }),
      ...(lateThresholdMinutes !== undefined && { lateThresholdMinutes: lateThresholdMinutes != null ? parseInt(lateThresholdMinutes) || null : null }),
      ...(breakWindowStart !== undefined && { breakWindowStart: breakWindowStart || null }),
      ...(breakWindowEnd !== undefined && { breakWindowEnd: breakWindowEnd || null }),
      ...(allowedBreakMinutes !== undefined && { allowedBreakMinutes: allowedBreakMinutes != null ? parseInt(allowedBreakMinutes) || null : null }),
      updatedAt: new Date(),
    }).where(eq(eventsTable.id, id)).returning();
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Drafts never have shifts — only create/sync shift when event is live
    if (event.status !== "draft") {
      await upsertEventShift({
        id: event.id,
        role: event.role,
        startDate: new Date(event.startDate),
        endDate: new Date(event.endDate),
        payPerDay: event.payPerDay,
        genderRequired: event.genderRequired,
        totalSlots: event.totalSlots,
      });
    }

    res.json({ ...event, attendanceCleared });
  } catch (err: any) {
    const cause = err?.cause;
    console.error("PUT /events/:id error:", err?.message || err, "| cause:", cause?.message ?? cause);
    res.status(500).json({ error: cause?.message || err?.message || "Server error" });
  }
});

// ── UNLOCK EVENT ──────────────────────────────────────────────────────────────
router.patch("/events/:id/unlock", requireAdmin, async (req: any, res) => {
  const adminUserId: number = req.session.userId;
  const id = parseInt(req.params.id);
  try {
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: "Password required", code: "PASSWORD_REQUIRED" });

    const [admin] = await db.select({ passwordHash: usersTable.passwordHash, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, adminUserId));
    if (!admin) return res.status(403).json({ error: "Admin not found" });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      await auditLog("UNLOCK_FAILED", id, null, admin.email, "Wrong password");
      return res.status(401).json({ error: "Incorrect password", code: "WRONG_PASSWORD" });
    }

    const [ev] = await db.select({ title: eventsTable.title, lockedReason: eventsTable.lockedReason })
      .from(eventsTable).where(eq(eventsTable.id, id));
    if (!ev) return res.status(404).json({ error: "Event not found" });

    await db.update(eventsTable)
      .set({ isLocked: false, lockedReason: null, lockedAt: null, updatedAt: new Date() })
      .where(eq(eventsTable.id, id));

    await auditLog("UNLOCK", id, ev.title, admin.email, `Unlocked from: ${ev.lockedReason ?? "unknown"}`);
    console.log(`[events] Unlocked event ${id}`);
    res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("PATCH /events/:id/unlock error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── ARCHIVE (soft delete) ─────────────────────────────────────────────────────
router.patch("/events/:id/archive", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params.id);
  try {
    const [ev] = await db.select({ title: eventsTable.title }).from(eventsTable).where(eq(eventsTable.id, id));
    if (!ev) return res.status(404).json({ error: "Event not found" });

    await db.update(eventsTable)
      .set({ status: sql`'archived'::event_status` as any, updatedAt: new Date() })
      .where(eq(eventsTable.id, id));

    const adminEmail = req.session?.email ?? null;
    await auditLog("ARCHIVE", id, ev.title, adminEmail);

    console.log(`[events] Archived event ${id}`);
    res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("PATCH /events/:id/archive error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── RESTORE (un-archive) ──────────────────────────────────────────────────────
router.patch("/events/:id/restore", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params.id);
  try {
    const [ev] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const restoredStatus = autoStatus(new Date(ev.startDate), new Date(ev.endDate));
    await db.update(eventsTable)
      .set({ status: sql`${restoredStatus}::event_status` as any, updatedAt: new Date() })
      .where(eq(eventsTable.id, id));

    const adminEmail = req.session?.email ?? null;
    await auditLog("RESTORE", id, ev.title, adminEmail, `Restored to: ${restoredStatus}`);

    console.log(`[events] Restored event ${id} → ${restoredStatus}`);
    res.json({ success: true, restoredStatus });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("PATCH /events/:id/restore error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── PERMANENT DELETE ──────────────────────────────────────────────────────────
// ── Delete a DRAFT event (no password needed — drafts have no published data) ──
router.delete("/events/:id/draft", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event id" });

    const [ev] = await db
      .select({ id: eventsTable.id, status: eventsTable.status, title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id));

    if (!ev) return res.status(404).json({ error: "Event not found" });
    if (ev.status !== "draft") return res.status(400).json({ error: "Event is not a draft" });

    // Drafts should have no shifts, but clean up just in case
    const eventShifts = await db.select({ id: shiftsTable.id }).from(shiftsTable).where(eq(shiftsTable.eventId, id));
    if (eventShifts.length > 0) {
      const shiftIds = eventShifts.map(s => s.id);
      await db.delete(shiftClaimsTable).where(inArray(shiftClaimsTable.shiftId, shiftIds));
      await db.delete(shiftsTable).where(eq(shiftsTable.eventId, id));
    }
    await db.delete(eventsTable).where(eq(eventsTable.id, id));

    console.log(`[events] Draft ${id} ("${ev.title}") deleted`);
    res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("DELETE /events/:id/draft error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Delete a published event (password-protected) ──
router.delete("/events/:id", requireAdmin, async (req: any, res) => {
  const adminUserId: number = req.session.userId;
  try {
    const id = parseInt(req.params.id);
    const { password } = req.body;

    // Rate-limit check
    const now = Date.now();
    let attempts = deleteAttempts.get(adminUserId) ?? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    if (now > attempts.resetAt) attempts = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };

    if (attempts.count >= MAX_DELETE_ATTEMPTS) {
      const waitMin = Math.ceil((attempts.resetAt - now) / 60_000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${waitMin} min.`, code: "RATE_LIMITED" });
    }

    // Password required
    if (!password) return res.status(400).json({ error: "Password required", code: "PASSWORD_REQUIRED" });

    // Look up admin user and verify password
    const [admin] = await db.select({ passwordHash: usersTable.passwordHash, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, adminUserId));
    if (!admin) return res.status(403).json({ error: "Admin not found" });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      attempts.count += 1;
      deleteAttempts.set(adminUserId, attempts);
      const remaining = MAX_DELETE_ATTEMPTS - attempts.count;
      await auditLog("DELETE_FAILED", id, null, admin.email, `Wrong password (${attempts.count} attempts)`);
      return res.status(401).json({
        error: "Incorrect password",
        code: "WRONG_PASSWORD",
        attemptsRemaining: remaining,
      });
    }

    // Reset rate limit on success
    deleteAttempts.delete(adminUserId);

    // Get event info before deleting (for audit log)
    const [ev] = await db.select({ title: eventsTable.title }).from(eventsTable).where(eq(eventsTable.id, id));

    // 1. Get all shifts for this event
    const eventShifts = await db.select({ id: shiftsTable.id }).from(shiftsTable).where(eq(shiftsTable.eventId, id));
    if (eventShifts.length > 0) {
      const shiftIds = eventShifts.map(s => s.id);
      const claims = await db.select({ id: shiftClaimsTable.id })
        .from(shiftClaimsTable).where(inArray(shiftClaimsTable.shiftId, shiftIds));
      if (claims.length > 0) {
        const claimIds = claims.map(c => c.id);
        await db.delete(paymentsTable).where(inArray(paymentsTable.shiftClaimId, claimIds));
      }
      await db.delete(shiftClaimsTable).where(inArray(shiftClaimsTable.shiftId, shiftIds));
      await db.delete(shiftsTable).where(eq(shiftsTable.eventId, id));
    }

    // 2. Delete the event — referrals nulled via ON DELETE SET NULL
    await db.delete(eventsTable).where(eq(eventsTable.id, id));

    await auditLog("DELETE", id, ev?.title ?? null, admin.email, `Permanent delete | shifts: ${eventShifts.length}`);
    console.log(`[events] Permanently deleted event ${id} | shifts: ${eventShifts.length}`);
    res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || String(err) || "Server error";
    console.error("DELETE /events/:id error:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
