import { pgTable, text, serial, timestamp, integer, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shiftClaimsTable } from "./shifts";

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "processing", "paid", "failed"]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  crewId: integer("crew_id").notNull(),
  shiftClaimId: integer("shift_claim_id").references(() => shiftClaimsTable.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  reference: text("reference"),
  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
