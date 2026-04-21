import { pgTable, text, serial, timestamp, integer, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { eventsTable } from "./events";
import { crewProfilesTable } from "./crew";

export const referralStatusEnum = pgEnum("referral_status", ["pending", "joined", "successful", "selected", "confirmed", "rejected", "pending_approval", "paid"]);

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => eventsTable.id, { onDelete: "set null" }),
  referrerId: integer("referrer_id").notNull().references(() => crewProfilesTable.id),
  referredUserId: integer("referred_user_id").references(() => usersTable.id),
  referredPhone: text("referred_phone"),
  referralCode: text("referral_code").notNull(),
  status: referralStatusEnum("status").notNull().default("pending"),
  rewardAmount: numeric("reward_amount", { precision: 10, scale: 2 }),
  rewardPaid: text("reward_paid").notNull().default("no"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referralsTable.$inferSelect;
