import { pgTable, text, serial, timestamp, integer, numeric, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventStatusEnum = pgEnum("event_status", ["upcoming", "ongoing", "completed", "cancelled", "draft", "archived"]);

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  city: text("city"),
  location: text("location").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: eventStatusEnum("status").notNull().default("upcoming"),
  clientName: text("client_name"),
  role: text("role"),
  genderRequired: text("gender_required"),
  workTask: text("work_task"),
  payPerDay: numeric("pay_per_day", { precision: 10, scale: 2 }),
  payFemale: numeric("pay_female", { precision: 10, scale: 2 }),
  payFemaleMax: numeric("pay_female_max", { precision: 10, scale: 2 }),
  payMale: numeric("pay_male", { precision: 10, scale: 2 }),
  payMaleMax: numeric("pay_male_max", { precision: 10, scale: 2 }),
  payFresher: numeric("pay_fresher", { precision: 10, scale: 2 }),
  timings: text("timings"),
  dressCode: text("dress_code"),
  dressCodeImage: text("dress_code_image"),
  foodProvided: boolean("food_provided").notNull().default(false),
  mealsProvided: text("meals_provided"),
  travelAllowance: text("travel_allowance").notNull().default("not_included"),
  incentives: text("incentives"),
  referralReward: numeric("referral_reward", { precision: 10, scale: 2 }),
  referralMessage: text("referral_message"),
  totalSlots: integer("total_slots").notNull().default(10),
  totalShifts: integer("total_shifts").notNull().default(0),
  filledShifts: integer("filled_shifts").notNull().default(0),
  expectedCheckIn: text("expected_check_in"),
  expectedCheckOut: text("expected_check_out"),
  lateThresholdMinutes: integer("late_threshold_minutes").notNull().default(15),
  breakWindowStart: text("break_window_start"),
  breakWindowEnd: text("break_window_end"),
  allowedBreakMinutes: integer("allowed_break_minutes"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  roleConfigs: text("role_configs"),
  isLocked: boolean("is_locked").notNull().default(false),
  lockedReason: text("locked_reason"),
  lockedAt: timestamp("locked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true, updatedAt: true, totalShifts: true, filledShifts: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
