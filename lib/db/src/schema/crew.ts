import { pgTable, text, serial, timestamp, integer, numeric, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const crewProfilesTable = pgTable("crew_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  phone: text("phone").notNull(),
  city: text("city"),
  age: integer("age"),
  gender: text("gender"),
  category: text("category"),
  customRole: text("custom_role"),
  experienceLevel: text("experience_level"),
  languages: text("languages"),
  height: text("height"),
  skills: text("skills"),
  experience: text("experience"),
  emergencyContact: text("emergency_contact"),
  bankAccount: text("bank_account"),
  instagramUrl: text("instagram_url"),
  payHolderName: text("pay_holder_name"),
  payBankName: text("pay_bank_name"),
  payBranchName: text("pay_branch_name"),
  payAccountNumber: text("pay_account_number"),
  payIfscCode: text("pay_ifsc_code"),
  payUpiId: text("pay_upi_id"),
  panNumber: text("pan_number"),
  panCardUrl: text("pan_card_url"),
  pendingPayHolderName: text("pending_pay_holder_name"),
  pendingPayBankName: text("pending_pay_bank_name"),
  pendingPayBranchName: text("pending_pay_branch_name"),
  pendingPayAccountNumber: text("pending_pay_account_number"),
  pendingPayIfscCode: text("pending_pay_ifsc_code"),
  pendingPayUpiId: text("pending_pay_upi_id"),
  pendingPanNumber: text("pending_pan_number"),
  pendingPanCardUrl: text("pending_pan_card_url"),
  pendingBankAccount: text("pending_bank_account"),
  // Editable profile pending fields
  pendingName: text("pending_name"),
  pendingCity: text("pending_city"),
  pendingLanguages: text("pending_languages"),
  pendingExperience: text("pending_experience"),
  pendingCategory: text("pending_category"),
  // How did they hear about us (filled at registration)
  heardAboutUs: text("heard_about_us"),
  // Portfolio photos (JSON array of base64 data URIs)
  portfolioPhotos: text("portfolio_photos"),
  // Parallel JSON array of quality tags: "good" | "rejected" | null
  photoQuality: text("photo_quality"),
  // Introduction video URL (stored in object storage, served via /api/storage/objects/)
  introVideoUrl: text("intro_video_url"),
  // Admin rating for intro video: "good" | "can_be_improved" | null
  introVideoQuality: text("intro_video_quality"),
  hasPendingChanges: boolean("has_pending_changes").notNull().default(false),
  pendingChangesStatus: text("pending_changes_status"),
  adminMessage: text("admin_message"),
  blacklistReason: text("blacklist_reason"),
  rejectionReason: text("rejection_reason"),
  idType: text("id_type"),
  aadhaarCardUrl: text("aadhaar_card_url"),
  collegeIdUrl: text("college_id_url"),
  closeUpPhotoUrl: text("close_up_photo_url"),
  fullLengthPhotoUrl: text("full_length_photo_url"),
  totalEarnings: numeric("total_earnings", { precision: 10, scale: 2 }).notNull().default("0"),
  completedShifts: integer("completed_shifts").notNull().default(0),
  walletBalance: numeric("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  totalReferrals: integer("total_referrals").notNull().default(0),
  successfulReferrals: integer("successful_referrals").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  phoneUnique: unique("crew_phone_unique").on(table.phone),
}));

export const insertCrewProfileSchema = createInsertSchema(crewProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrewProfile = z.infer<typeof insertCrewProfileSchema>;
export type CrewProfile = typeof crewProfilesTable.$inferSelect;
