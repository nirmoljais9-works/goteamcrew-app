import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { paymentsTable, usersTable, crewProfilesTable, shiftClaimsTable, shiftsTable, eventsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

async function auditLock(event_id: number, event_name: string | null, reason: string) {
  try {
    await db.execute(sql`
      INSERT INTO activity_logs (action_type, event_id, event_name, admin_email, detail, created_at)
      VALUES ('LOCK', ${event_id}, ${event_name}, 'system', ${reason}, NOW())
    `);
  } catch {}
}

async function checkAndAutoLockEvent(eventId: number) {
  try {
    const eventShifts = await db.select({ id: shiftsTable.id }).from(shiftsTable).where(eq(shiftsTable.eventId, eventId));
    if (eventShifts.length === 0) return;
    const shiftIds = eventShifts.map(s => s.id);
    const claims = await db.select({ id: shiftClaimsTable.id }).from(shiftClaimsTable).where(inArray(shiftClaimsTable.shiftId, shiftIds));
    if (claims.length === 0) return;
    const claimIds = claims.map(c => c.id);
    const payments = await db.select({ status: paymentsTable.status }).from(paymentsTable).where(inArray(paymentsTable.shiftClaimId, claimIds));
    if (payments.length === 0) return;
    const allPaid = payments.every(p => p.status === "paid");
    if (allPaid) {
      const [ev] = await db.select({ title: eventsTable.title, isLocked: eventsTable.isLocked }).from(eventsTable).where(eq(eventsTable.id, eventId));
      if (ev && !ev.isLocked) {
        await db.update(eventsTable).set({ isLocked: true, lockedReason: "payment", lockedAt: new Date() }).where(eq(eventsTable.id, eventId));
        await auditLock(eventId, ev.title, "Auto-locked: all payments paid");
        console.log(`[payments] Auto-locked event ${eventId}: all payments paid`);
      }
    }
  } catch (e) {
    console.error("[payments] checkAndAutoLockEvent error:", e);
  }
}

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

function parseNum(v: any): number {
  return v !== null && v !== undefined ? parseFloat(v) || 0 : 0;
}

router.get("/payments", requireAuth, async (req: any, res) => {
  try {
    const isAdmin = req.session.role === "admin";

    if (isAdmin) {
      const rows = await db
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
          crewPhone: crewProfilesTable.phone,
          crewPhotoUrl: crewProfilesTable.closeUpPhotoUrl,
          shiftRole: shiftsTable.role,
          basePay: shiftsTable.totalPay,
          eventTitle: eventsTable.title,
          eventStartDate: eventsTable.startDate,
          eventEndDate: eventsTable.endDate,
          eventCity: eventsTable.city,
          eventLocation: eventsTable.location,
          eventPayPerDay: eventsTable.payPerDay,
          claimApprovedPay: shiftClaimsTable.approvedPay,
          claimCheckInStatus: shiftClaimsTable.checkInStatus,
          claimCheckOutStatus: shiftClaimsTable.checkOutStatus,
          claimIsAbsent: shiftClaimsTable.isAbsent,
          claimCheckedInAt: shiftClaimsTable.checkedInAt,
          claimCheckOutAt: shiftClaimsTable.checkOutAt,
          attendanceApproved: shiftClaimsTable.attendanceApproved,
        })
        .from(paymentsTable)
        .innerJoin(crewProfilesTable, eq(crewProfilesTable.id, paymentsTable.crewId))
        .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId))
        .leftJoin(shiftClaimsTable, eq(shiftClaimsTable.id, paymentsTable.shiftClaimId))
        .leftJoin(shiftsTable, eq(shiftsTable.id, shiftClaimsTable.shiftId))
        .leftJoin(eventsTable, eq(eventsTable.id, shiftsTable.eventId));

      res.json(rows.map(p => ({
        ...p,
        amount: parseNum(p.amount),
        basePay: parseNum(p.basePay),
        claimApprovedPay: p.claimApprovedPay !== null && p.claimApprovedPay !== undefined ? parseNum(p.claimApprovedPay) : null,
        eventPayPerDay: p.eventPayPerDay ? parseNum(p.eventPayPerDay) : null,
      })));
    } else {
      const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.userId, req.session.userId));
      if (!profile) return res.json([]);

      const rows = await db
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
          shiftRole: shiftsTable.role,
          basePay: shiftsTable.totalPay,
          eventTitle: eventsTable.title,
          eventStartDate: eventsTable.startDate,
          eventEndDate: eventsTable.endDate,
          eventCity: eventsTable.city,
          eventPayPerDay: eventsTable.payPerDay,
          claimApprovedPay: shiftClaimsTable.approvedPay,
          claimCheckInStatus: shiftClaimsTable.checkInStatus,
          claimCheckOutStatus: shiftClaimsTable.checkOutStatus,
          claimIsAbsent: shiftClaimsTable.isAbsent,
          attendanceApproved: shiftClaimsTable.attendanceApproved,
        })
        .from(paymentsTable)
        .innerJoin(crewProfilesTable, eq(crewProfilesTable.id, paymentsTable.crewId))
        .innerJoin(usersTable, eq(usersTable.id, crewProfilesTable.userId))
        .leftJoin(shiftClaimsTable, eq(shiftClaimsTable.id, paymentsTable.shiftClaimId))
        .leftJoin(shiftsTable, eq(shiftsTable.id, shiftClaimsTable.shiftId))
        .leftJoin(eventsTable, eq(eventsTable.id, shiftsTable.eventId))
        .where(eq(paymentsTable.crewId, profile.id));

      res.json(rows.map(p => ({
        ...p,
        amount: parseNum(p.amount),
        basePay: parseNum(p.basePay),
        claimApprovedPay: p.claimApprovedPay !== null && p.claimApprovedPay !== undefined ? parseNum(p.claimApprovedPay) : null,
        eventPayPerDay: p.eventPayPerDay ? parseNum(p.eventPayPerDay) : null,
      })));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/payments", requireAdmin, async (req: any, res) => {
  try {
    const { crewId, shiftClaimId, amount, paymentMethod, reference, notes } = req.body;
    if (!crewId || !amount) return res.status(400).json({ error: "crewId and amount required" });

    const [payment] = await db.insert(paymentsTable).values({
      crewId: parseInt(crewId),
      shiftClaimId: shiftClaimId ? parseInt(shiftClaimId) : null,
      amount: amount.toString(),
      paymentMethod: paymentMethod || null,
      reference: reference || null,
      notes: notes || null,
      status: "pending",
    }).returning();

    const [profile] = await db.select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable).where(eq(crewProfilesTable.id, parseInt(crewId)));
    const [user] = profile
      ? await db.select().from(usersTable).where(eq(usersTable.id, profile.userId))
      : [null];

    res.status(201).json({
      ...payment,
      amount: parseNum(payment.amount),
      basePay: 0,
      crewName: user?.name || "Unknown",
      shiftRole: null,
      eventTitle: null,
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/payments/:id", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, reference, notes, paidAt, paymentMethod } = req.body;

    const [payment] = await db.update(paymentsTable).set({
      ...(status && { status }),
      ...(paymentMethod !== undefined && { paymentMethod: paymentMethod || null }),
      ...(reference !== undefined && { reference }),
      ...(notes !== undefined && { notes }),
      ...(paidAt && { paidAt: new Date(paidAt) }),
      ...(status === "paid" && !paidAt && { paidAt: new Date() }),
      updatedAt: new Date(),
    }).where(eq(paymentsTable.id, id)).returning();

    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if (status === "paid") {
      const [profile] = await db.select().from(crewProfilesTable).where(eq(crewProfilesTable.id, payment.crewId));
      if (profile) {
        const newTotal = (parseFloat(profile.totalEarnings || "0") + parseFloat(payment.amount || "0")).toFixed(2);
        await db.update(crewProfilesTable).set({
          totalEarnings: newTotal,
          updatedAt: new Date(),
        }).where(eq(crewProfilesTable.id, payment.crewId));
      }

      // Fire-and-forget: auto-lock event if all payments are now paid
      if (payment.shiftClaimId) {
        const [claim] = await db.select({ shiftId: shiftClaimsTable.shiftId }).from(shiftClaimsTable).where(eq(shiftClaimsTable.id, payment.shiftClaimId));
        if (claim) {
          const [shift] = await db.select({ eventId: shiftsTable.eventId }).from(shiftsTable).where(eq(shiftsTable.id, claim.shiftId));
          if (shift) checkAndAutoLockEvent(shift.eventId);
        }
      }
    }

    const [profile] = await db.select({ userId: crewProfilesTable.userId })
      .from(crewProfilesTable).where(eq(crewProfilesTable.id, payment.crewId));
    const [user] = profile
      ? await db.select().from(usersTable).where(eq(usersTable.id, profile.userId))
      : [null];

    res.json({
      ...payment,
      amount: parseNum(payment.amount),
      basePay: 0,
      crewName: user?.name || "Unknown",
      shiftRole: null,
      eventTitle: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
