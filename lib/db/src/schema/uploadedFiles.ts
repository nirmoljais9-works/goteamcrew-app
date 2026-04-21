import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const uploadedFilesTable = pgTable("uploaded_files", {
  id: serial("id").primaryKey(),
  dataB64: text("data_b64").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
