import { pgTable, text, serial, timestamp, integer, numeric, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";

export const shiftStatusEnum = pgEnum("shift_status", ["open", "claimed", "approved", "completed", "cancelled"]);
export const claimStatusEnum = pgEnum("claim_status", ["pending", "approved", "rejected", "revoked"]);

export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => eventsTable.id),
  role: text("role").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  totalPay: numeric("total_pay", { precision: 10, scale: 2 }).notNull().default("0"),
  spotsTotal: integer("spots_total").notNull().default(1),
  spotsFilled: integer("spots_filled").notNull().default(0),
  status: shiftStatusEnum("status").notNull().default("open"),
  requirements: text("requirements"),
  genderPreference: text("gender_preference"),
  experienceRequired: text("experience_required"),
  paymentType: text("payment_type"),
  dressCode: text("dress_code"),
  groomingInstructions: text("grooming_instructions"),
  applicationsOpen: boolean("applications_open").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const shiftClaimsTable = pgTable("shift_claims", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shiftsTable.id),
  crewId: integer("crew_id").notNull(),
  status: claimStatusEnum("status").notNull().default("pending"),
  claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
  checkedInAt: timestamp("checked_in_at"),
  checkInLat: text("check_in_lat"),
  checkInLng: text("check_in_lng"),
  selfieImage: text("selfie_image"),
  isAbsent: boolean("is_absent").notNull().default(false),
  checkInStatus: text("check_in_status"),
  checkOutAt: timestamp("check_out_at"),
  checkOutStatus: text("check_out_status"),
  breakStartAt: timestamp("break_start_at"),
  breakEndAt: timestamp("break_end_at"),
  totalBreakMinutes: integer("total_break_minutes").notNull().default(0),
  breakExceeded: boolean("break_exceeded").notNull().default(false),
  checkOutLat: text("check_out_lat"),
  checkOutLng: text("check_out_lng"),
  checkOutPhotoUrl: text("check_out_photo_url"),
  attendanceDate: text("attendance_date"),
  attendanceApproved: boolean("attendance_approved"),
  approvedPay: numeric("approved_pay", { precision: 10, scale: 2 }),
  isOverride: boolean("is_override").notNull().default(false),
  overrideReason: text("override_reason"),
  distanceFromEvent: numeric("distance_from_event", { precision: 10, scale: 2 }),
  appliedRoles: text("applied_roles"),
  assignedRole: text("assigned_role"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertShiftSchema = createInsertSchema(shiftsTable).omit({ id: true, createdAt: true, updatedAt: true, totalPay: true, spotsFilled: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shiftsTable.$inferSelect;

export const insertShiftClaimSchema = createInsertSchema(shiftClaimsTable).omit({ id: true, claimedAt: true, updatedAt: true, approvedAt: true });
export type InsertShiftClaim = z.infer<typeof insertShiftClaimSchema>;
export type ShiftClaim = typeof shiftClaimsTable.$inferSelect;
