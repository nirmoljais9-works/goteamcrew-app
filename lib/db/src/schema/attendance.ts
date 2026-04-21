import { pgTable, serial, integer, timestamp, text, boolean } from "drizzle-orm/pg-core";
import { shiftClaimsTable } from "./shifts";

export const attendanceBreaksTable = pgTable("attendance_breaks", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => shiftClaimsTable.id),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at"),
  durationMinutes: integer("duration_minutes"),
  isOutsideWindow: boolean("is_outside_window").notNull().default(false),
  lat: text("lat"),
  lng: text("lng"),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AttendanceBreak = typeof attendanceBreaksTable.$inferSelect;
