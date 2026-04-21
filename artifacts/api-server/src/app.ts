import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./routes";

const app: Express = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

const PgStore = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

app.use(session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    tableName: "sessions",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "manpower-agency-secret-key-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: "auto",   // auto = secure when request is HTTPS, plain when HTTP
    httpOnly: true,
    sameSite: isProduction ? "lax" : "none", // lax for same-origin production; none for Replit cross-origin proxy
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(async (req: any, _res, next) => {
  if (req.session?.userId) {
    try {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
      if (user) {
        req.session.role = user.role;
      }
    } catch {}
  }
  next();
});

// OneSignal service worker — must be served at root scope
app.get("/OneSignalSDKWorker.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.send(`importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");\n`);
});

app.use("/api", router);

// Global error handler — catches anything Express doesn't handle in routes
app.use((err: any, _req: any, res: any, _next: any) => {
  const cause = err?.cause;
  const msg = cause?.message || err?.message || String(err) || "Unknown error";
  console.error("[global-error-handler]", msg, "\nstack:", err?.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: msg });
  }
});

// In production, serve the built React frontend and handle SPA routing
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.join(process.cwd(), "artifacts", "manpower-agency", "dist", "public");

  // Hashed assets (/assets/*.js, /assets/*.css) — cache aggressively for 1 year.
  // Vite content-hashes the filename on every build, so a new deploy = new filename
  // = browser always fetches fresh code. Safe to cache forever.
  app.use("/assets", express.static(path.join(frontendDist, "assets"), {
    maxAge: "1y",
    immutable: true,
    etag: false,
    lastModified: false,
  }));

  // All other static files (images, fonts, favicon, etc.) — short cache, revalidate.
  app.use(express.static(frontendDist, {
    index: false,           // do NOT auto-serve index.html here — we handle it below
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      // index.html must never be cached — it embeds the hashed asset filenames.
      // If the browser caches it, users see old code even after a deploy.
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }));

  // SPA fallback — all unmatched routes return index.html (for client-side routing).
  // Always send no-cache so the browser fetches a fresh copy after every deploy.
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
