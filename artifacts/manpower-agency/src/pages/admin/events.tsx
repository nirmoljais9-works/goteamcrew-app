import { useGetEvents, useCreateEvent, useUpdateEvent, useDeleteEvent, getGetEventsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { CalendarPlus, Pencil, Trash2, MapPin, IndianRupee, Wand2, Clock, Gift, Users2, CheckCircle2, XCircle, Loader2, UserCheck, LocateFixed, BookMarked, ChevronDown, ChevronUp, Send, Plus, X } from "lucide-react";
import { PlacesAutocompleteInput } from "@/components/places-autocomplete-input";

type GeoStatus = "idle" | "pending" | "success" | "error";

interface RoleConfig {
  gender: "male" | "female" | "both";
  role: string;
  task: string;
  payMale: string;
  payFemale: string;
  payMaleError?: string;
  payFemaleError?: string;
}

/** Sanitise a pay input value in real-time:
 *  - allow digits only  → "1500"
 *  - allow one dash (range) → "1000-4000"
 *  Returns the cleaned string (may still be incomplete while typing). */
function sanitizePayInput(raw: string): string {
  // Remove everything that isn't a digit or a dash
  let s = raw.replace(/[^\d-]/g, "");
  // Collapse multiple dashes; only one allowed
  const dashIdx = s.indexOf("-");
  if (dashIdx !== -1) {
    s = s.slice(0, dashIdx + 1) + s.slice(dashIdx + 1).replace(/-/g, "");
  }
  return s;
}

/** Normalise on blur: "1000-4000" stays "1000-4000"; "1500" stays "1500"; bad input → "" */
function normalizePayInput(raw: string): string {
  const s = raw.trim().replace(/[–—]/g, "-");
  const parts = s.split("-").map(p => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    if (!isNaN(a) && !isNaN(b) && b >= a) return `${a}-${b}`;
    if (!isNaN(a)) return String(a);
    return "";
  }
  const n = parseInt(parts[0] || "");
  return !isNaN(n) ? String(n) : "";
}

/** Build a ₹-prefixed display string from a stored range like "1000-4000" or "1500" */
function formatPayDisplay(val: string | null | undefined, maxVal?: string | null): string {
  if (!val) return "";
  const min = parseFloat(val);
  if (isNaN(min)) return "";
  const max = maxVal ? parseFloat(maxVal) : NaN;
  if (!isNaN(max) && max !== min) return `₹${min.toLocaleString("en-IN")} – ₹${max.toLocaleString("en-IN")}`;
  return `₹${min.toLocaleString("en-IN")}`;
}

/** Convert a stored pay value ("1000" or "1000-4000") to display rupee string */
function payValToDisplay(val: string | null | undefined): string {
  if (!val) return "";
  const s = String(val).replace(/[–—]/g, "-");
  const parts = s.split("-").map(p => p.trim()).filter(Boolean);
  const min = parseFloat(parts[0] || "");
  const max = parts[1] ? parseFloat(parts[1]) : NaN;
  if (isNaN(min)) return "";
  if (!isNaN(max) && max !== min) return `₹${min.toLocaleString("en-IN")} – ₹${max.toLocaleString("en-IN")}`;
  return `₹${min.toLocaleString("en-IN")}`;
}

/** Reconstruct a range string from separate min/max values */
function buildPayRange(min: string | null | undefined, max: string | null | undefined): string {
  const a = min ? parseFloat(min) : NaN;
  if (isNaN(a)) return "";
  const b = max ? parseFloat(max) : NaN;
  if (!isNaN(b) && b !== a) return `${a}-${b}`;
  return String(a);
}

/** Capitalize the first letter of every word */
function capitalizeWords(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function extractCoordsFromMapsUrl(url: string): { lat: string; lng: string } | null {
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: atMatch[1], lng: atMatch[2] };
  const qMatch = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) return { lat: qMatch[1], lng: qMatch[2] };
  const llMatch = url.match(/ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) return { lat: llMatch[1], lng: llMatch[2] };
  return null;
}

const LAST_PREFS_KEY = "gtc_last_event_prefs";
const DRAFT_KEY = "gtc_event_form_draft";

function parseTime(t: string): string {
  if (!t) return "00:00";
  const clean = t.trim();
  if (/^\d{1,2}:\d{2}$/.test(clean)) return clean.padStart(5, "0");
  const m = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return "00:00";
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

const formSchema = z.object({
  title: z.string().min(1, "Required"),
  location: z.string().min(1, "Required"),
  role: z.string().optional().default(""),
  genderRequired: z.string().optional().default("both"),
  workTask: z.string().optional(),
  payPerDay: z.string().optional(),
  payFemale: z.string().optional(),
  payMale: z.string().optional(),
  payFresher: z.string().optional(),
  totalSlots: z.string().optional(),
  startDate: z.string().min(1, "Required"),
  startTime: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
  endTime: z.string().min(1, "Required"),
  dressCode: z.string().optional(),
  dressCodeImage: z.string().optional(),
  description: z.string().optional(),
  foodProvided: z.enum(["yes", "no"]).default("no"),
  mealsProvided: z.enum(["1 Meal", "2 Meals", "3 Meals", "Snacks Only"]).optional(),
  incentives: z.string().optional(),
  referralReward: z.string().optional(),
  referralMessage: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  expectedCheckIn: z.string().optional(),
  expectedCheckOut: z.string().optional(),
  lateThresholdMinutes: z.string().optional(),
  breakWindowStart: z.string().optional(),
  breakWindowEnd: z.string().optional(),
  allowedBreakMinutes: z.string().optional(),
}).refine(
  (d) => {
    if (!d.startDate || !d.endDate) return true;
    if (d.endDate > d.startDate) return true;
    if (d.endDate === d.startDate) return d.endTime >= d.startTime;
    return false;
  },
  { message: "End must be after start", path: ["endTime"] }
);

type FormValues = z.infer<typeof formSchema>;

function extractAreaFromLocation(location: string): string {
  if (!location) return "";

  // Form combined "City – Venue" format (set by eventToForm)
  if (location.includes(" – ")) return location.split(" – ")[0].trim();
  if (location.includes(" - ")) return location.split(" - ")[0].trim();

  // Split by comma (handles full Google Maps addresses)
  const parts = location.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return location.trim();

  // Full address ending with "India" (Google Maps format):
  // e.g. "21, Cassia Marg, DLF Phase 2, Sector 25, Gurugram, Haryana 122002, India"
  // Strip: "India" → then "State PIN" → what's left last is the city
  if (parts[parts.length - 1].toLowerCase() === "india") {
    const withoutCountry = parts.slice(0, -1);          // remove "India"
    const withoutState   = withoutCountry.length >= 2
      ? withoutCountry.slice(0, -1)                      // remove "State [PIN]"
      : withoutCountry;
    return withoutState[withoutState.length - 1] || location.trim();
  }

  // Other comma-separated format ("Venue Name, City"):
  // Return the last segment — typically the city
  return parts[parts.length - 1];
}

function generateReferralMessage(values: FormValues, configs: RoleConfig[]): string {
  const { title, location, startDate, endDate, startTime, endTime } = values;
  const firstConfig = configs[0];

  const areaOnly = extractAreaFromLocation(location);

  let dateStr = "";
  if (startDate) {
    const toD = (s: string) => new Date(s + "T00:00:00");
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    dateStr = (endDate && endDate !== startDate) ? `${fmt(toD(startDate))} – ${fmt(toD(endDate))}` : fmt(toD(startDate));
    if (startTime) dateStr += ` | ${formatTime12h(startTime)}${endTime ? ` – ${formatTime12h(endTime)}` : ""}`;
  }

  const roleOrTitle = firstConfig?.role || title || "";
  const payM = firstConfig?.payMale ? parseFloat(firstConfig.payMale) : null;
  const payF = firstConfig?.payFemale ? parseFloat(firstConfig.payFemale) : null;
  const minP = payM ?? payF;
  const payStr = minP
    ? (payM && payF && payM !== payF ? `M:₹${payM.toFixed(0)} F:₹${payF.toFixed(0)}` : `₹${minP.toFixed(0)}`)
    : null;
  const payLine = payStr ? ` | 💰 ${payStr}` : "";
  const gender = firstConfig?.gender;
  const genderLabel = gender && gender !== "both"
    ? gender.charAt(0).toUpperCase() + gender.slice(1)
    : null;

  const lines: string[] = ["Hey 👋", "", "Paid event on Goteamcrew", ""];
  if (roleOrTitle) lines.push(`Work: ${roleOrTitle}`);
  if (genderLabel) lines.push(`Gender: ${genderLabel}`);
  if (areaOnly) lines.push(`📍 ${areaOnly}`);
  if (dateStr) lines.push(`📅 ${dateStr}${payLine}`);
  else if (payStr) lines.push(`💰 ${payStr}`);
  lines.push("", "Apply here 👇");
  return lines.join("\n");
}

function getISTComponents(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const h = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${h}:${p.minute}` };
}

function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function to24h(h12: number, min: number, ampm: "AM" | "PM"): string {
  let h = h12 % 12;
  if (ampm === "PM") h += 12;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function from24h(val: string): { h12: number; min: number; ampm: "AM" | "PM" } {
  const [hStr, mStr] = (val || "00:00").split(":");
  const h24 = parseInt(hStr, 10) || 0;
  const min = parseInt(mStr, 10) || 0;
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return { h12, min, ampm };
}

function TimePicker12h({
  value,
  onChange,
  onCustomize,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCustomize?: () => void;
  compact?: boolean;
}) {
  const { h12, min, ampm } = from24h(value || "00:00");

  const set = (newH12: number, newMin: number, newAmpm: "AM" | "PM") => {
    onChange(to24h(newH12, newMin, newAmpm));
    onCustomize?.();
  };

  const selectCls = compact
    ? "h-8 w-14 px-1.5 text-xs rounded-xl border border-input bg-muted/50 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-all appearance-none text-center cursor-pointer"
    : "h-10 w-16 px-2 text-sm rounded-xl border border-input bg-muted/50 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-all appearance-none text-center cursor-pointer";

  return (
    <div className="flex items-center gap-1.5">
      <select value={h12} onChange={(e) => set(parseInt(e.target.value), min, ampm)} className={selectCls}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>{h.toString().padStart(2, "0")}</option>
        ))}
      </select>

      <span className="text-muted-foreground font-bold select-none">:</span>

      <select value={min} onChange={(e) => set(h12, parseInt(e.target.value), ampm)} className={selectCls}>
        {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
          <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>
        ))}
      </select>

      <div className={compact
        ? "flex rounded-xl border border-input overflow-hidden bg-muted/50 h-8 shrink-0"
        : "flex rounded-xl border border-input overflow-hidden bg-muted/50 h-10 shrink-0"
      }>
        {(["AM", "PM"] as const).map((ap) => (
          <button
            key={ap}
            type="button"
            onClick={() => set(h12, min, ap)}
            className={[
              compact ? "px-2 text-xs" : "px-3 text-sm",
              "font-semibold transition-colors",
              ampm === ap ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
            ].join(" ")}
          >
            {ap}
          </button>
        ))}
      </div>
    </div>
  );
}

function computeStatus(ev: any): string {
  if (ev.status === "cancelled") return "cancelled";
  const now = new Date();
  const start = new Date(ev.startDate);
  const end = new Date(ev.endDate);
  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "ongoing";
  return "completed";
}

function eventToFormValues(ev: any): FormValues {
  const start = getISTComponents(new Date(ev.startDate));
  const end = getISTComponents(new Date(ev.endDate));
  const combinedLocation = ev.city ? `${ev.city} – ${ev.location}` : (ev.location ?? "");
  return {
    title: ev.title ?? "",
    location: combinedLocation,
    role: ev.role ?? "",
    genderRequired: ev.genderRequired ?? "both",
    workTask: ev.workTask ?? "",
    payPerDay: ev.payPerDay ? parseFloat(ev.payPerDay).toString() : "",
    payFemale: buildPayRange(ev.payFemale, ev.payFemaleMax),
    payMale: buildPayRange(ev.payMale, ev.payMaleMax),
    payFresher: ev.payFresher ? parseFloat(ev.payFresher).toString() : "",
    totalSlots: ev.totalSlots ? ev.totalSlots.toString() : "10",
    mealsProvided: (ev.mealsProvided as any) || undefined,
    incentives: ev.incentives ?? "",
    referralReward: ev.referralReward ? parseFloat(ev.referralReward).toString() : "",
    referralMessage: (ev as any).referralMessage ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    dressCode: ev.dressCode ?? "",
    dressCodeImage: ev.dressCodeImage ?? "",
    description: ev.description ?? "",
    foodProvided: ev.foodProvided ? "yes" : "no",
    latitude: ev.latitude ?? "",
    longitude: ev.longitude ?? "",
    expectedCheckIn: ev.expectedCheckIn ?? "",
    expectedCheckOut: ev.expectedCheckOut ?? "",
    lateThresholdMinutes: ev.lateThresholdMinutes != null ? ev.lateThresholdMinutes.toString() : "",
    breakWindowStart: ev.breakWindowStart ?? "",
    breakWindowEnd: ev.breakWindowEnd ?? "",
    allowedBreakMinutes: ev.allowedBreakMinutes != null ? ev.allowedBreakMinutes.toString() : "",
  };
}

const BLANK: FormValues = {
  title: "", location: "",
  role: "", genderRequired: "both", workTask: "",
  payPerDay: "", payFemale: "", payMale: "", payFresher: "", totalSlots: "10",
  startDate: "", startTime: "10:00",
  endDate: "", endTime: "18:00",
  dressCode: "", dressCodeImage: "", description: "",
  foodProvided: "no",
  mealsProvided: undefined,
  incentives: "",
  referralReward: "",
  referralMessage: "",
  latitude: "",
  longitude: "",
  expectedCheckIn: "",
  expectedCheckOut: "",
  lateThresholdMinutes: "",
  breakWindowStart: "",
  breakWindowEnd: "",
  allowedBreakMinutes: "",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 pb-1 border-b border-border/60 mb-2">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</p>
    </div>
  );
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function AdminEvents() {
  const { data: events, isLoading } = useGetEvents(undefined, { query: { queryKey: getGetEventsQueryKey(), refetchInterval: 60_000 } });
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();
  const deleteMutation = useDeleteEvent();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [deleteModalEvent, setDeleteModalEvent] = useState<{ id: number; title: string } | null>(null);
  const [permDeleteEvent, setPermDeleteEvent] = useState<{ id: number; title: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const [isPermDeleting, setIsPermDeleting] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [unlockEvent, setUnlockEvent] = useState<{ id: number; title: string; reason: string | null } | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockPasswordError, setUnlockPasswordError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [lastPrefs, setLastPrefs] = useState<any>(null);
  const [timePreset, setTimePreset] = useState<"9to6" | "10to7" | "custom">("custom");
  const [roleConfigs, setRoleConfigs] = useState<RoleConfig[]>([{ gender: "both", role: "", task: "", payMale: "", payFemale: "" }]);
  const [roleConfigError, setRoleConfigError] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [deleteDraftId, setDeleteDraftId] = useState<number | null>(null);
  const [referralsEventId, setReferralsEventId] = useState<number | null>(null);
  const [referralsEventTitle, setReferralsEventTitle] = useState<string>("");
  const [referralsData, setReferralsData] = useState<any[]>([]);
  const [referralsLoading, setReferralsLoading] = useState(false);
  const [referralActionId, setReferralActionId] = useState<number | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{ id: number; data: any } | null>(null);
  const [activeTab, setActiveTab] = useState<"upcoming" | "ongoing" | "completed" | "all" | "archived" | "locked">("upcoming");
  const [confirmReplaceMsg, setConfirmReplaceMsg] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);

  const isEditing = editingEvent !== null;
  const isEditingDraft = isEditing && editingEvent?.status === "draft";
  const isPending = isEditing ? updateMutation.isPending : createMutation.isPending;

  const { data: dbDrafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: ["event-drafts"],
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/events/drafts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch drafts");
      return r.json();
    },
    staleTime: 30_000,
  });

  const { data: archivedEvents = [], refetch: refetchArchived } = useQuery<any[]>({
    queryKey: ["events-archived"],
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/events/archived`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch archived events");
      return r.json();
    },
    staleTime: 30_000,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: BLANK });
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoMessage, setGeoMessage] = useState("");

  // Handle a paste of a Google Maps URL directly into the location field
  const handleLocationPaste = useCallback((pasted: string) => {
    const isMapsUrl = pasted.includes("google.com/maps") || pasted.includes("maps.google");
    if (!isMapsUrl) return;
    const coords = extractCoordsFromMapsUrl(pasted);
    if (coords) {
      form.setValue("latitude", coords.lat, { shouldDirty: true });
      form.setValue("longitude", coords.lng, { shouldDirty: true });
      setGeoStatus("success");
      setGeoMessage(`📍 Coordinates extracted from Maps link (${parseFloat(coords.lat).toFixed(4)}, ${parseFloat(coords.lng).toFixed(4)})`);
    } else {
      setGeoStatus("error");
      setGeoMessage("⚠️ Could not extract coordinates from link — paste the full URL with @lat,lng in it, or select from dropdown.");
    }
  }, [form]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_PREFS_KEY);
      if (saved) setLastPrefs(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (!open) {
      form.reset(BLANK);
      setEditingEvent(null);
      setTimePreset("custom");
      setHasDraft(false);
      setDraftSaved(false);
      setIsMultiDay(false);
      setRoleConfigs([{ gender: "both", role: "", task: "", payMale: "", payFemale: "" }]);
      setRoleConfigError("");
      if (draftTimer.current) clearTimeout(draftTimer.current);
      setGeoStatus("idle");
      setGeoMessage("");
    }
  }, [open]);

  useEffect(() => {
    if (editingEvent && open) {
      const vals = eventToFormValues(editingEvent);
      form.reset(vals);
      setIsMultiDay(!!vals.startDate && !!vals.endDate && vals.startDate !== vals.endDate);
      setTimePreset("custom");
      setRoleConfigError("");

      // Synthesize roleConfigs from saved data or legacy fields
      // toPayStr: convert any pay value to a safe string for the text input
      //   - New format "1000-4000" → preserved as-is
      //   - Old range like "2500–6000" → normalised to "2500-6000"
      //   - Single number → "2500"
      const toPayStr = (v: any, vMax?: any): string => {
        if (v == null || v === "") return "";
        const s = String(v).trim();
        // If the stored value is already a range string (e.g. "1000-4000"), normalise it
        // directly — don't pass through buildPayRange which uses parseFloat and loses the max.
        if (s.includes("-")) return normalizePayInput(s);
        // Single value: combine with optional separate max column
        return normalizePayInput(buildPayRange(s, vMax != null ? String(vMax) : null));
      };
      const toPayFields = (c: any): { payMale: string; payFemale: string } => {
        // Old configs may have minPay/maxPay; new ones have payMale/payFemale (range strings or plain numbers)
        const legacyPay = c.minPay != null ? toPayStr(c.minPay, c.maxPay) : toPayStr(c.pay);
        const pm = c.payMale != null ? toPayStr(c.payMale) : (c.gender !== "female" ? legacyPay : "");
        const pf = c.payFemale != null ? toPayStr(c.payFemale) : (c.gender !== "male" ? (c.minPay != null || c.pay != null ? legacyPay : "") : "");
        return { payMale: pm, payFemale: pf };
      };

      if (editingEvent.roleConfigs) {
        try {
          const parsed = JSON.parse(editingEvent.roleConfigs);
          setRoleConfigs(parsed.map((c: any) => ({
            gender: c.gender || "both",
            role: c.role || "",
            task: c.task || "",
            ...toPayFields(c),
          })));
        } catch {
          const pm = buildPayRange(editingEvent.payMale, (editingEvent as any).payMaleMax);
          const pf = buildPayRange(editingEvent.payFemale, (editingEvent as any).payFemaleMax) || buildPayRange(editingEvent.payPerDay, null);
          setRoleConfigs([{ gender: "both", role: editingEvent.role || "", task: editingEvent.workTask || "", payMale: pm, payFemale: pf }]);
        }
      } else if (editingEvent.payFemale && editingEvent.payMale) {
        setRoleConfigs([{
          gender: "both",
          role: editingEvent.role || "",
          task: editingEvent.workTask || "",
          payMale: buildPayRange(editingEvent.payMale, (editingEvent as any).payMaleMax),
          payFemale: buildPayRange(editingEvent.payFemale, (editingEvent as any).payFemaleMax),
        }]);
      } else if (editingEvent.payFemale) {
        setRoleConfigs([{ gender: "female", role: editingEvent.role || "", task: editingEvent.workTask || "", payMale: "", payFemale: buildPayRange(editingEvent.payFemale, (editingEvent as any).payFemaleMax) }]);
      } else if (editingEvent.payMale) {
        setRoleConfigs([{ gender: "male", role: editingEvent.role || "", task: editingEvent.workTask || "", payMale: buildPayRange(editingEvent.payMale, (editingEvent as any).payMaleMax), payFemale: "" }]);
      } else {
        const p = buildPayRange(editingEvent.payPerDay, null);
        const g = (editingEvent.genderRequired || "both") as "male" | "female" | "both";
        setRoleConfigs([{ gender: g, role: editingEvent.role || "", task: editingEvent.workTask || "", payMale: p, payFemale: p }]);
      }

      if (editingEvent.latitude && editingEvent.longitude) {
        setGeoStatus("success");
        setGeoMessage(`📍 Saved (${parseFloat(editingEvent.latitude).toFixed(4)}, ${parseFloat(editingEvent.longitude).toFixed(4)})`);
      } else {
        setGeoStatus("pending");
        setGeoMessage("⚠️ No coordinates saved. Select from dropdown to enable GPS validation.");
      }
    } else if (!editingEvent && open) {
      setGeoStatus("idle");
      setGeoMessage("");
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) setHasDraft(true);
      } catch {}
    }
  }, [editingEvent, open]);

  // Auto-save to localStorage (debounced 800 ms) — only when creating, not editing
  useEffect(() => {
    if (!open || isEditing) return;
    const { unsubscribe } = form.watch((values) => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
          setDraftSaved(true);
        } catch {}
      }, 800);
    });
    return () => {
      unsubscribe();
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [open, isEditing]);

  const watchedTitle = form.watch("title");
  const watchedLocation = form.watch("location");
  const startDate = form.watch("startDate");
  const endDate = form.watch("endDate");
  const startTime = form.watch("startTime");
  const endTime = form.watch("endTime");
  const watchedFoodProvided = form.watch("foodProvided");

  // Derived from roleConfigs[0] for preview / referral message
  const primaryRole    = roleConfigs[0]?.role || "";
  const primaryMinPay  = roleConfigs[0]?.payMale ? parseFloat(roleConfigs[0].payMale) : (roleConfigs[0]?.payFemale ? parseFloat(roleConfigs[0].payFemale) : null);
  const primaryMaxPay  = primaryMinPay;
  const primaryPay     = primaryMinPay;

  // In single-day mode, keep endDate in sync with startDate automatically
  useEffect(() => {
    if (!isMultiDay && startDate) {
      form.setValue("endDate", startDate, { shouldValidate: false });
    }
  }, [isMultiDay, startDate]);

  const effectiveEndDate = isMultiDay ? endDate : startDate;

  const totalDays = useMemo(() => {
    if (!startDate || !effectiveEndDate) return null;
    const diff = Math.round((new Date(effectiveEndDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    return diff > 0 ? diff : null;
  }, [startDate, effectiveEndDate]);

  const showPreview = !!(watchedTitle && watchedLocation && startDate);

  const applyPreset = (preset: "9to6" | "10to7" | "custom") => {
    setTimePreset(preset);
    if (preset === "9to6") { form.setValue("startTime", "09:00"); form.setValue("endTime", "18:00"); }
    else if (preset === "10to7") { form.setValue("startTime", "10:00"); form.setValue("endTime", "19:00"); }
  };

  const applyLastPrefs = () => {
    if (!lastPrefs) return;
    if (lastPrefs.roleConfigs) setRoleConfigs(lastPrefs.roleConfigs);
    if (lastPrefs.startTime) { form.setValue("startTime", lastPrefs.startTime); setTimePreset("custom"); }
    if (lastPrefs.endTime) form.setValue("endTime", lastPrefs.endTime);
    toast({ title: "Last event data applied" });
  };

  const restoreDraft = () => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) { form.reset(JSON.parse(draft)); setHasDraft(false); toast({ title: "Draft restored" }); }
    } catch {}
  };

  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setHasDraft(false);
  };

  const handleOpenCreate = () => { setEditingEvent(null); setOpen(true); };
  const handleOpenEdit = (ev: any) => { setEditingEvent(ev); setOpen(true); };
  const handleDelete = (ev: any) => setDeleteModalEvent({ id: ev.id, title: ev.title });

  const handleArchive = async () => {
    if (!deleteModalEvent) return;
    setIsArchiving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/events/${deleteModalEvent.id}/archive`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to archive");
      toast({ title: "Event archived" });
      setDeleteModalEvent(null);
      queryClient.invalidateQueries({ queryKey: [`/api/events`] });
      refetchArchived();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Archive failed", description: err.message });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleRestore = async (eventId: number) => {
    setRestoringId(eventId);
    try {
      const res = await fetch(`${BASE_URL}/api/events/${eventId}/restore`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to restore");
      toast({ title: "Event restored" });
      queryClient.invalidateQueries({ queryKey: [`/api/events`] });
      refetchArchived();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Restore failed", description: err.message });
    } finally {
      setRestoringId(null);
    }
  };

  const handleUnlock = async () => {
    if (!unlockEvent) return;
    if (!unlockPassword.trim()) { setUnlockPasswordError("Password required"); return; }
    setIsUnlocking(true);
    try {
      const res = await fetch(`${BASE_URL}/api/events/${unlockEvent.id}/unlock`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "WRONG_PASSWORD") { setUnlockPasswordError("Incorrect password"); return; }
        throw new Error(json.error || "Failed to unlock");
      }
      toast({ title: "Event unlocked successfully" });
      setUnlockEvent(null);
      setUnlockPassword("");
      queryClient.invalidateQueries({ queryKey: [`/api/events`] });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Unlock failed", description: err.message });
    } finally {
      setIsUnlocking(false);
    }
  };

  const openPermDelete = (ev: { id: number; title: string }) => {
    setPermDeleteEvent(ev);
    setDeletePassword("");
    setDeletePasswordError("");
    setDeleteModalEvent(null);
  };

  const handlePermDelete = async () => {
    if (!permDeleteEvent) return;
    if (!deletePassword.trim()) {
      setDeletePasswordError("Password required");
      return;
    }
    setIsPermDeleting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/events/${permDeleteEvent.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "WRONG_PASSWORD") {
          const remaining = json.attemptsRemaining ?? 0;
          setDeletePasswordError(remaining > 0
            ? `Incorrect password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Incorrect password. No more attempts for 15 minutes.");
          return;
        }
        if (json.code === "RATE_LIMITED") {
          setDeletePasswordError(json.error);
          return;
        }
        throw new Error(json.error || "Failed to delete");
      }
      toast({ title: "Event permanently deleted" });
      setPermDeleteEvent(null);
      setDeletePassword("");
      queryClient.invalidateQueries({ queryKey: [`/api/events`] });
      refetchArchived();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Delete failed", description: err.message });
    } finally {
      setIsPermDeleting(false);
    }
  };

  const saveDraft = async () => {
    const values = form.getValues();
    if (!values.title?.trim()) {
      toast({ variant: "destructive", title: "Event title is required to save a draft" });
      return;
    }
    setSavingDraft(true);
    try {
      const st = values.startTime ? parseTime(values.startTime) : null;
      const et = values.endTime ? parseTime(values.endTime) : null;
      const startISO = values.startDate && st ? new Date(`${values.startDate}T${st}:00+05:30`).toISOString() : null;
      const endISO = values.endDate && et ? new Date(`${values.endDate}T${et}:00+05:30`).toISOString() : null;
      const timings = st && et ? `${formatTime12h(st)} – ${formatTime12h(et)} IST` : null;

      const payload: any = {
        saveAsDraft: true,
        title: values.title,
        location: values.location || null,
        roleConfigs: JSON.stringify(roleConfigs.map(c => ({
          gender: c.gender, role: c.role, task: c.task,
          payMale: c.gender !== "female" ? (c.payMale || null) : null,
          payFemale: c.gender !== "male" ? (c.payFemale || null) : null,
        }))),
        totalSlots: values.totalSlots ? parseInt(values.totalSlots) || 10 : 10,
        ...(startISO && { startDate: startISO }),
        ...(endISO && { endDate: endISO }),
        ...(timings && { timings }),
        dressCode: values.dressCode || null,
        dressCodeImage: values.dressCodeImage || null,
        description: values.description || null,
        foodProvided: values.foodProvided === "yes",
        mealsProvided: values.foodProvided === "yes" ? (values.mealsProvided || null) : null,
        incentives: values.incentives || null,
        referralReward: values.referralReward ? parseFloat(values.referralReward) || null : null,
        referralMessage: values.referralMessage || null,
        latitude: values.latitude || null,
        longitude: values.longitude || null,
        expectedCheckIn: values.expectedCheckIn || null,
        expectedCheckOut: values.expectedCheckOut || null,
        lateThresholdMinutes: values.lateThresholdMinutes ? parseInt(values.lateThresholdMinutes) || null : null,
        breakWindowStart: values.breakWindowStart || null,
        breakWindowEnd: values.breakWindowEnd || null,
        allowedBreakMinutes: values.allowedBreakMinutes ? parseInt(values.allowedBreakMinutes) || null : null,
      };

      if (isEditingDraft && editingEvent?.id) {
        // Update existing draft
        const r = await fetch(`${BASE_URL}/api/events/${editingEvent.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json())?.error || "Failed");
        toast({ title: "Draft updated" });
      } else {
        // Create new draft
        const r = await fetch(`${BASE_URL}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json())?.error || "Failed");
        toast({ title: "Draft saved successfully" });
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
      }
      refetchDrafts();
      setDraftsOpen(true);
      setOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to save draft", description: err.message });
    } finally {
      setSavingDraft(false);
    }
  };

  const confirmDeleteDraft = async () => {
    if (deleteDraftId === null) return;
    try {
      const r = await fetch(`${BASE_URL}/api/events/${deleteDraftId}/draft`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      toast({ title: "Draft deleted" });
      refetchDrafts();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to delete draft", description: err?.message });
    } finally {
      setDeleteDraftId(null);
    }
  };

  const saveLastPrefs = (_finalRole: string, values: FormValues) => {
    try {
      const prefs = {
        roleConfigs,
        startTime: values.startTime,
        endTime: values.endTime,
      };
      localStorage.setItem(LAST_PREFS_KEY, JSON.stringify(prefs));
      setLastPrefs(prefs);
    } catch {}
  };

  const doUpdate = (id: number, data: any, role: string, formValues: FormValues) => {
    updateMutation.mutate({ id, data }, {
      onSuccess: (resp: any) => {
        const cleared = resp?.attendanceCleared ?? 0;
        const msg = cleared > 0
          ? `Event updated. Attendance cleared for ${cleared} shift(s) due to date change.`
          : "Event updated";
        toast({ title: msg });
        saveLastPrefs(role, formValues);
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/events`] });
        refetchDrafts();
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Failed to update event", description: err?.data?.error || err?.message });
      },
    });
  };

  const onSubmit = (values: FormValues) => {
    // Validate roleConfigs
    const validConfigs = roleConfigs.filter(c => c.role.trim() || c.task.trim() || c.payMale || c.payFemale);
    if (validConfigs.length === 0) {
      setRoleConfigError("Add at least one role configuration.");
      return;
    }
    const hasPayError = roleConfigs.some(c => c.payMaleError || c.payFemaleError);
    if (hasPayError) {
      setRoleConfigError("Fix pay range errors before saving (max must be ≥ min).");
      return;
    }
    setRoleConfigError("");

    const st = parseTime(values.startTime);
    const et = parseTime(values.endTime);
    const startISO = new Date(`${values.startDate}T${st}:00+05:30`).toISOString();
    const endISO   = new Date(`${values.endDate}T${et}:00+05:30`).toISOString();
    const timings  = `${formatTime12h(st)} – ${formatTime12h(et)} IST`;

    const payload = {
      title: values.title,
      city: "",
      location: values.location,
      roleConfigs: JSON.stringify(roleConfigs.map(c => ({
        gender: c.gender, role: c.role, task: c.task,
        payMale: c.gender !== "female" ? (c.payMale || null) : null,
        payFemale: c.gender !== "male" ? (c.payFemale || null) : null,
      }))),
      totalSlots: values.totalSlots ? parseInt(values.totalSlots) || 10 : 10,
      startDate: startISO,
      endDate: endISO,
      timings,
      dressCode: values.dressCode || "",
      dressCodeImage: values.dressCodeImage || "",
      description: values.description || "",
      foodProvided: values.foodProvided === "yes",
      mealsProvided: values.foodProvided === "yes" ? (values.mealsProvided || null) : null,
      incentives: values.incentives || "",
      referralReward: values.referralReward ? parseFloat(values.referralReward) || null : null,
      referralMessage: values.referralMessage || null,
      latitude: values.latitude || null,
      longitude: values.longitude || null,
      expectedCheckIn: values.expectedCheckIn || null,
      expectedCheckOut: values.expectedCheckOut || null,
      lateThresholdMinutes: values.lateThresholdMinutes ? parseInt(values.lateThresholdMinutes) || null : null,
      breakWindowStart: values.breakWindowStart || null,
      breakWindowEnd: values.breakWindowEnd || null,
      allowedBreakMinutes: values.allowedBreakMinutes ? parseInt(values.allowedBreakMinutes) || null : null,
    };

    if (isEditing) {
      // Check if the IST calendar date is changing — if so, warn before wiping attendance.
      const oldDate = editingEvent.startDate
        ? new Date(editingEvent.startDate).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
        : null;
      const newDate = values.startDate;
      const dateChanged = oldDate && newDate && oldDate !== newDate;

      if (dateChanged) {
        setPendingPayload({ id: editingEvent.id, data: payload });
        return;
      }

      doUpdate(editingEvent.id, payload, primaryRole, values);
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          toast({ title: "Event created" });
          saveLastPrefs(primaryRole, values);
          try { localStorage.removeItem(DRAFT_KEY); } catch {}
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: [`/api/events`] });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Failed to create event", description: err?.data?.error || err?.message });
        },
      });
    }
  };

  const openReferrals = async (eventId: number, eventTitle: string) => {
    setReferralsEventId(eventId);
    setReferralsEventTitle(eventTitle);
    setReferralsData([]);
    setReferralsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/referrals?eventId=${eventId}`, { credentials: "include" });
      const json = await res.json();
      setReferralsData(Array.isArray(json) ? json : (json.referrals || []));
    } catch {
      toast({ variant: "destructive", title: "Failed to load referrals" });
    } finally {
      setReferralsLoading(false);
    }
  };

  const handleReferralAction = async (referralId: number, action: "confirm" | "reject") => {
    setReferralActionId(referralId);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/referrals/${referralId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast({ title: action === "confirm" ? "Referral confirmed — ₹100 added to referrer's wallet" : "Referral rejected" });
      if (referralsEventId !== null) await openReferrals(referralsEventId, referralsEventTitle);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Action failed", description: err.message });
    } finally {
      setReferralActionId(null);
    }
  };

  const categorizedEvents = useMemo(() => {
    const list = (events ?? []) as any[];
    const withStatus = list.map(ev => ({ ...ev, _status: computeStatus(ev) }));
    const upcoming  = withStatus.filter(e => e._status === "upcoming")
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const ongoing   = withStatus.filter(e => e._status === "ongoing")
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const completed = withStatus.filter(e => e._status === "completed")
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    const all       = [...withStatus].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    return { upcoming, ongoing, completed, all };
  }, [events]);

  const lockedEvents = useMemo(() => {
    const list = (events ?? []) as any[];
    return list.filter(e => e.isLocked && e.status !== "draft" && e.status !== "archived")
      .sort((a, b) => new Date(b.lockedAt ?? b.updatedAt).getTime() - new Date(a.lockedAt ?? a.updatedAt).getTime());
  }, [events]);

  const filteredEvents = activeTab === "archived"
    ? archivedEvents.slice().sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : activeTab === "locked"
      ? lockedEvents
      : categorizedEvents[activeTab];

  if (isLoading) return <div className="p-8 text-center">Loading events...</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Events</h1>
          <p className="text-muted-foreground mt-1">Create / Edit Events</p>
        </div>
        <Button className="rounded-xl h-12 shadow-md" onClick={handleOpenCreate}>
          <CalendarPlus className="w-5 h-5 mr-2" /> Create Event
        </Button>
      </div>

      {/* ── Status Tabs ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            { key: "upcoming",  label: "Upcoming",  count: categorizedEvents.upcoming.length },
            { key: "ongoing",   label: "Ongoing",   count: categorizedEvents.ongoing.length },
            { key: "completed", label: "Completed", count: categorizedEvents.completed.length },
            { key: "all",       label: "All",       count: categorizedEvents.all.length },
            { key: "archived",  label: "Archived",  count: archivedEvents.length },
            { key: "locked",    label: "🔒 Locked",  count: lockedEvents.length },
          ] as const
        ).map(({ key, label, count }) => {
          const isActive = activeTab === key;
          const activeBg = key === "archived" ? "bg-amber-500 text-white shadow-sm"
            : key === "locked" ? "bg-rose-600 text-white shadow-sm"
            : "bg-primary text-primary-foreground shadow-sm";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 ${
                isActive ? activeBg : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
              <span className={`text-xs font-bold min-w-[20px] text-center px-1.5 py-0.5 rounded-full ${
                isActive
                  ? "bg-white/20 text-inherit"
                  : "bg-border/80 text-muted-foreground"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Draft Events Section ─────────────────────────────────── */}
      {dbDrafts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-amber-100/60 transition-colors"
            onClick={() => setDraftsOpen(v => !v)}
          >
            <div className="flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-amber-600" />
              <span className="font-semibold text-amber-900 text-base">
                Draft Events
              </span>
              <span className="text-xs bg-amber-200 text-amber-800 rounded-full px-2 py-0.5 font-bold">
                {dbDrafts.length}
              </span>
            </div>
            {draftsOpen
              ? <ChevronUp className="w-4 h-4 text-amber-600" />
              : <ChevronDown className="w-4 h-4 text-amber-600" />
            }
          </button>
          {draftsOpen && (
            <div className="border-t border-amber-200 divide-y divide-amber-100">
              {dbDrafts.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-900 text-sm truncate">{d.title}</div>
                    <div className="text-xs text-amber-700 mt-0.5 flex items-center gap-2">
                      {d.role && <span>{d.role}</span>}
                      {d.role && d.updatedAt && <span>·</span>}
                      <span>Last edited {format(new Date(d.updatedAt), "dd MMM yyyy, h:mm a")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                      onClick={() => handleOpenEdit(d)}
                    >
                      <Pencil className="w-3 h-3 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-violet-600 hover:bg-violet-700"
                      onClick={() => { handleOpenEdit(d); }}
                    >
                      <Send className="w-3 h-3 mr-1" /> Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => setDeleteDraftId(d.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MOBILE: card list ── */}
      <div className="md:hidden flex flex-col gap-3">
        {filteredEvents.length === 0 && (
          <div className="bg-card rounded-2xl border border-border/60 py-12 text-center text-muted-foreground text-sm font-medium shadow-sm">
            {activeTab === "upcoming"  ? "No upcoming events" :
             activeTab === "ongoing"   ? "No ongoing events right now" :
             activeTab === "completed" ? "No completed events" :
             activeTab === "archived"  ? "No archived events" :
             activeTab === "locked"    ? "No locked events" :
             "No events found. Create one to get started."}
          </div>
        )}
        {filteredEvents.map((ev: any) => {
          const liveStatus = ev._status ?? computeStatus(ev);
          const startIST = getISTComponents(new Date(ev.startDate));
          const endIST = getISTComponents(new Date(ev.endDate));
          const sameDay = startIST.date === endIST.date;
          return (
            <div key={ev.id} className="bg-card rounded-2xl border border-border/60 shadow-sm p-4 flex flex-col gap-3">
              {/* Title + status row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-foreground text-base leading-snug">{ev.title}</div>
                  <div className="text-sm text-muted-foreground flex items-start gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="break-words">{ev.city ? `${ev.city} — ` : ""}{ev.location}</span>
                  </div>
                  {ev.role && (
                    <div className="text-xs text-primary font-medium mt-1">
                      {ev.role}{ev.genderRequired && ev.genderRequired !== "both" ? ` · ${ev.genderRequired} only` : ""}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {activeTab === "archived"
                    ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Archived</span>
                    : <StatusBadge status={liveStatus} />
                  }
                  {ev.isLocked && activeTab !== "archived" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">🔒 Locked</span>
                  )}
                </div>
              </div>

              {/* Dates + Pay + Slots row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <div>
                  <span className="font-medium text-foreground">
                    {format(new Date(ev.startDate), "MMM d")}
                    {!sameDay ? ` – ${format(new Date(ev.endDate), "MMM d, yyyy")}` : `, ${format(new Date(ev.startDate), "yyyy")}`}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">· {formatTime12h(startIST.time)} – {formatTime12h(endIST.time)}</span>
                </div>
                {(ev as any).payFemale || (ev as any).payMale ? (
                  <div className="font-semibold text-foreground text-xs">
                    {(ev as any).payMale && (ev as any).payFemale
                      ? ((ev as any).payMale === (ev as any).payFemale
                          ? <>{formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax)}<span className="text-muted-foreground font-normal">/day</span></>
                          : <>{`M:${formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax)} F:${formatPayDisplay((ev as any).payFemale, (ev as any).payFemaleMax)}`}<span className="text-muted-foreground font-normal">/day</span></>)
                      : <>{(ev as any).payMale ? formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax) : formatPayDisplay((ev as any).payFemale, (ev as any).payFemaleMax)}<span className="text-muted-foreground font-normal">/day</span></>
                    }
                  </div>
                ) : ev.payPerDay ? (
                  <div className="font-semibold text-foreground">
                    ₹{parseFloat(ev.payPerDay).toLocaleString("en-IN")}<span className="text-xs text-muted-foreground font-normal">/day</span>
                  </div>
                ) : null}
                <div className="text-muted-foreground text-xs">
                  <span className="font-semibold text-foreground">{ev.totalSlots ?? 10}</span> slots
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40">
                {activeTab === "archived" ? (
                  <>
                    <Button size="sm" variant="outline" className="flex-1 h-9 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                      disabled={restoringId === ev.id} onClick={() => handleRestore(ev.id)}>
                      {restoringId === ev.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                      Restore
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1 h-9 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => openPermDelete({ id: ev.id, title: ev.title })}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </>
                ) : (
                  <>
                    {ev.isLocked && (
                      <Button variant="outline" size="sm" className="h-9 text-xs text-amber-600 border-amber-300 hover:bg-amber-50 px-3 font-semibold"
                        onClick={() => setUnlockEvent({ id: ev.id, title: ev.title, reason: ev.lockedReason ?? null })}>
                        🔓 Unlock
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-9 text-xs text-violet-600 border-violet-300 hover:bg-violet-50 px-3"
                      onClick={() => openReferrals(ev.id, ev.title)}>
                      <Gift className="w-3.5 h-3.5 mr-1" /> Referrals
                    </Button>
                    <Button variant="outline" size="sm"
                      className={`h-9 text-xs px-3 ${ev.isLocked ? "text-muted-foreground/40 border-border/40 cursor-not-allowed" : "text-foreground border-border hover:bg-muted/50"}`}
                      onClick={() => { if (!ev.isLocked) handleOpenEdit(ev); }}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 text-xs px-3 text-rose-500 border-rose-200 hover:bg-rose-50"
                      onClick={() => handleDelete(ev)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DESKTOP: table ── */}
      <div className="hidden md:block bg-card rounded-2xl border border-border/60 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border/60 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="p-4 pl-6">Event & Role</th>
              <th className="p-4">Dates & Times (IST)</th>
              <th className="p-4">Pay</th>
              <th className="p-4">Slots</th>
              <th className="p-4">Status</th>
              <th className="p-4 pr-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filteredEvents.map((ev: any) => {
              const liveStatus = ev._status ?? computeStatus(ev);
              const startIST = getISTComponents(new Date(ev.startDate));
              const endIST = getISTComponents(new Date(ev.endDate));
              const sameDay = startIST.date === endIST.date;
              return (
                <tr key={ev.id} className="hover:bg-muted/20">
                  <td className="p-4 pl-6">
                    <div className="font-bold text-foreground text-base">{ev.title}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {ev.city ? `${ev.city} — ` : ""}{ev.location}
                    </div>
                    {ev.role && (
                      <div className="text-xs text-primary font-medium mt-1">
                        {ev.role}{ev.genderRequired && ev.genderRequired !== "both" ? ` · ${ev.genderRequired} only` : ""}
                      </div>
                    )}
                    {ev.workTask && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ev.workTask}</div>}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground whitespace-nowrap">
                    <div className="font-medium text-foreground">
                      {format(new Date(ev.startDate), "MMM d")}
                      {!sameDay ? ` – ${format(new Date(ev.endDate), "MMM d, yyyy")}` : `, ${format(new Date(ev.startDate), "yyyy")}`}
                    </div>
                    <div className="text-xs mt-0.5">{formatTime12h(startIST.time)} – {formatTime12h(endIST.time)} IST</div>
                  </td>
                  <td className="p-4 text-sm">
                    {(ev as any).payFemale || (ev as any).payMale ? (
                      <div className="font-semibold text-foreground text-xs">
                        {(ev as any).payMale && (ev as any).payFemale
                          ? ((ev as any).payMale === (ev as any).payFemale
                              ? <>{formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax)}<span className="text-muted-foreground font-normal">/day</span></>
                              : <>{`M:${formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax)} F:${formatPayDisplay((ev as any).payFemale, (ev as any).payFemaleMax)}`}<span className="text-muted-foreground font-normal">/day</span></>)
                          : <>{(ev as any).payMale ? formatPayDisplay((ev as any).payMale, (ev as any).payMaleMax) : formatPayDisplay((ev as any).payFemale, (ev as any).payFemaleMax)}<span className="text-muted-foreground font-normal">/day</span></>
                        }
                      </div>
                    ) : ev.payPerDay ? (
                      <div className="font-semibold text-foreground">₹{parseFloat(ev.payPerDay).toLocaleString("en-IN")}<span className="text-xs text-muted-foreground font-normal">/day</span></div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-4 text-sm">
                    <span className="font-semibold text-foreground">{ev.totalSlots ?? 10}</span>
                    <span className="text-xs text-muted-foreground"> slots</span>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      {activeTab === "archived"
                        ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Archived</span>
                        : <StatusBadge status={liveStatus} />
                      }
                      {ev.isLocked && activeTab !== "archived" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">
                          🔒 {ev.lockedReason === "payment" ? "Locked (Payment Done)" : "Locked (Completed)"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 pr-6 text-right">
                    {activeTab === "archived" ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                          disabled={restoringId === ev.id}
                          onClick={() => handleRestore(ev.id)}
                        >
                          {restoringId === ev.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => openPermDelete({ id: ev.id, title: ev.title })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {ev.isLocked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-2 font-semibold"
                            onClick={() => setUnlockEvent({ id: ev.id, title: ev.title, reason: ev.lockedReason ?? null })}
                          >
                            🔓 Unlock
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-violet-500 hover:text-violet-700 hover:bg-violet-50" title="View Referrals" onClick={() => openReferrals(ev.id, ev.title)}>
                          <Gift className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={ev.isLocked ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}
                          title={ev.isLocked ? "Event is locked — unlock first to edit" : "Edit event"}
                          onClick={() => { if (!ev.isLocked) handleOpenEdit(ev); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-700 hover:bg-rose-50" title="Manage deletion" onClick={() => handleDelete(ev)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredEvents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="text-muted-foreground text-sm font-medium">
                    {activeTab === "upcoming"  ? "No upcoming events" :
                     activeTab === "ongoing"   ? "No ongoing events right now" :
                     activeTab === "completed" ? "No completed events" :
                     activeTab === "archived"  ? "No archived events" :
                     activeTab === "locked"    ? "No locked events" :
                     "No events found. Create one to get started."}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirmClose(true); }}>
        <DialogContent
          className="sm:max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {isEditingDraft ? "Edit Draft" : isEditing ? "Edit Event" : "Create Event"}
            </DialogTitle>
          </DialogHeader>

          {!isEditing && hasDraft && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5 flex items-center justify-between gap-3 -mt-1">
              <span className="text-sm font-medium text-amber-800">Restore your previous draft?</span>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={restoreDraft}
                  className="text-xs bg-amber-600 text-white rounded-lg px-3 py-1.5 hover:bg-amber-700 transition-colors font-semibold"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="text-xs bg-white text-amber-700 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors font-medium"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          {!isEditing && !hasDraft && lastPrefs && (
            <div className="flex gap-2 -mt-1">
              <button
                type="button"
                onClick={applyLastPrefs}
                className="flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-100 transition-colors font-medium"
              >
                <Wand2 className="w-3 h-3" /> Use Last Event Data
              </button>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 pt-1">

              <SectionHeading>Basic</SectionHeading>
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Title</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      {...field}
                      onBlur={() => {
                        field.onChange(capitalizeWords(field.value ?? ""));
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <LocateFixed className="w-3.5 h-3.5 text-primary" />
                    Location / Venue
                  </FormLabel>
                  <FormControl>
                    {/*
                      key forces a full re-mount when the dialog opens/closes or
                      switches between create vs edit — this sets the correct defaultValue.
                      The input is UNCONTROLLED after mount so typing never blurs the cursor.
                    */}
                    <PlacesAutocompleteInput
                      key={`loc-${editingEvent?.id ?? "new"}-${open}`}
                      defaultValue={field.value}
                      placeholder="Search venue, shop, hall, restaurant…"
                      onInputChange={(val, isFromPlaceSelection) => {
                        // Keep form field in sync (does not re-render the input)
                        field.onChange(val);
                        if (val.includes("google.com/maps") || val.includes("maps.google")) {
                          // Maps URL paste — extract coords from URL
                          handleLocationPaste(val);
                        } else if (!isFromPlaceSelection) {
                          // User is typing freely (not selecting from dropdown) — clear stale
                          // coords so old lat/lng from a previous place doesn't get saved.
                          // When the user DOES select from the dropdown, isFromPlaceSelection=true
                          // and we skip this so onPlaceSelected can set the fresh coords.
                          form.setValue("latitude", "", { shouldDirty: true });
                          form.setValue("longitude", "", { shouldDirty: true });
                          setGeoStatus("idle");
                          setGeoMessage("");
                        }
                      }}
                      onPlaceSelected={(place) => {
                        field.onChange(place.formatted);
                        form.setValue("latitude", place.lat, { shouldDirty: true });
                        form.setValue("longitude", place.lng, { shouldDirty: true });
                        setGeoStatus("success");
                        setGeoMessage(`📍 Location selected from Google (${parseFloat(place.lat).toFixed(4)}, ${parseFloat(place.lng).toFixed(4)})`);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                  {geoStatus !== "idle" && geoMessage && (
                    <p className={`text-xs flex items-center gap-1 mt-0.5 font-medium ${
                      geoStatus === "success" ? "text-emerald-700" : "text-amber-700"
                    }`}>
                      {geoMessage}
                    </p>
                  )}
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="latitude" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      Latitude
                      {geoStatus !== "success" && <span className="text-[10px] text-rose-500 font-semibold">(for GPS check-in)</span>}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 19.0760"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (e.target.value) {
                            setGeoStatus("success");
                            setGeoMessage(`📍 Manual coordinates entered`);
                          } else {
                            setGeoStatus("pending");
                            setGeoMessage("⚠️ No coordinates — GPS validation won't work.");
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="longitude" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      Longitude
                      {geoStatus !== "success" && <span className="text-[10px] text-rose-500 font-semibold">(for GPS check-in)</span>}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 72.8777"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (e.target.value) {
                            setGeoStatus("success");
                            setGeoMessage(`📍 Manual coordinates entered`);
                          } else {
                            setGeoStatus("pending");
                            setGeoMessage("⚠️ No coordinates — GPS validation won't work.");
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <SectionHeading>Job Details & Payment</SectionHeading>
              <div className="space-y-3">
                {roleConfigs.map((config, i) => (
                  <div key={i} className="border border-border/60 rounded-2xl p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Role {roleConfigs.length > 1 ? i + 1 : ""}
                      </p>
                      {roleConfigs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRoleConfigs(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-foreground block mb-1.5">Gender</label>
                        <select
                          value={config.gender}
                          onChange={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, gender: e.target.value as any } : c))}
                          className="w-full h-9 px-3 text-sm rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="both">Both</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground block mb-1.5">Role Required</label>
                        <Input
                          value={config.role}
                          onChange={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, role: e.target.value } : c))}
                          onBlur={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, role: capitalizeWords(e.target.value) } : c))}
                          placeholder="e.g. Hostess, Anchor…"
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-foreground block mb-1.5">Work / Task</label>
                      <Input
                        value={config.task}
                        onChange={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, task: e.target.value } : c))}
                        placeholder="Describe the task…"
                        className="h-9"
                      />
                    </div>

                    {/* Pay fields — conditional on gender */}
                    <div className={config.gender === "both" ? "grid grid-cols-2 gap-3" : ""}>
                      {/* Male pay — shown for "male" and "both" */}
                      {(config.gender === "male" || config.gender === "both") && (
                        <div>
                          <label className="text-xs font-medium text-foreground block mb-1.5">
                            Pay per Day {config.gender === "both" ? "(Male)" : ""} <span className="text-muted-foreground font-normal">₹ or range</span>
                          </label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              type="text"
                              inputMode="numeric"
                              className={`pl-9 h-9 ${config.payMaleError ? "border-destructive" : ""}`}
                              value={config.payMale}
                              onChange={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, payMale: sanitizePayInput(e.target.value), payMaleError: undefined } : c))}
                              onBlur={e => {
                                const raw = e.target.value;
                                const normalized = normalizePayInput(raw);
                                const hadRange = raw.includes("-");
                                const lostRange = hadRange && !normalized.includes("-");
                                setRoleConfigs(prev => prev.map((c, idx) => idx === i ? {
                                  ...c,
                                  payMale: normalized,
                                  payMaleError: lostRange ? "Max must be ≥ min" : undefined,
                                } : c));
                              }}
                              placeholder="e.g. 1500 or 1000-4000"
                            />
                          </div>
                          {config.payMaleError
                            ? <p className="text-xs text-destructive mt-1">{config.payMaleError}</p>
                            : config.gender !== "both" && !config.payMale
                              ? <p className="text-xs text-destructive mt-1">Required</p>
                              : null}
                        </div>
                      )}
                      {/* Female pay — shown for "female" and "both" */}
                      {(config.gender === "female" || config.gender === "both") && (
                        <div>
                          <label className="text-xs font-medium text-foreground block mb-1.5">
                            Pay per Day {config.gender === "both" ? "(Female)" : ""} <span className="text-muted-foreground font-normal">₹ or range</span>
                          </label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              type="text"
                              inputMode="numeric"
                              className={`pl-9 h-9 ${config.payFemaleError ? "border-destructive" : ""}`}
                              value={config.payFemale}
                              onChange={e => setRoleConfigs(prev => prev.map((c, idx) => idx === i ? { ...c, payFemale: sanitizePayInput(e.target.value), payFemaleError: undefined } : c))}
                              onBlur={e => {
                                const raw = e.target.value;
                                const normalized = normalizePayInput(raw);
                                const hadRange = raw.includes("-");
                                const lostRange = hadRange && !normalized.includes("-");
                                setRoleConfigs(prev => prev.map((c, idx) => idx === i ? {
                                  ...c,
                                  payFemale: normalized,
                                  payFemaleError: lostRange ? "Max must be ≥ min" : undefined,
                                } : c));
                              }}
                              placeholder="e.g. 1500 or 1000-4000"
                            />
                          </div>
                          {config.payFemaleError
                            ? <p className="text-xs text-destructive mt-1">{config.payFemaleError}</p>
                            : config.gender !== "both" && !config.payFemale
                              ? <p className="text-xs text-destructive mt-1">Required</p>
                              : null}
                        </div>
                      )}
                    </div>
                    {/* Both gender validation */}
                    {config.gender === "both" && (!config.payMale || !config.payFemale) && (config.payMale || config.payFemale) && (
                      <p className="text-xs text-destructive -mt-1">Both male and female pay are required</p>
                    )}
                  </div>
                ))}

                {roleConfigError && (
                  <p className="text-xs text-destructive font-medium">{roleConfigError}</p>
                )}

                <button
                  type="button"
                  onClick={() => setRoleConfigs(prev => [...prev, { gender: "both", role: "", task: "", payMale: "", payFemale: "" }])}
                  className="w-full py-2.5 border border-dashed border-primary/40 text-primary rounded-xl text-sm font-medium hover:bg-primary/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Role Configuration
                </button>
              </div>

              <SectionHeading>Slots</SectionHeading>
              <FormField control={form.control} name="totalSlots" render={({ field }) => (
                <FormItem>
                  <FormLabel>Total Slots</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" min="1" placeholder="e.g. 10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <SectionHeading>Timing (IST)</SectionHeading>

              {/* Event type toggle */}
              <div className="flex rounded-xl border border-border overflow-hidden text-sm font-medium w-fit">
                <button
                  type="button"
                  onClick={() => setIsMultiDay(false)}
                  className={`px-4 py-2 transition-colors ${!isMultiDay ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                >
                  Single Day
                </button>
                <button
                  type="button"
                  onClick={() => setIsMultiDay(true)}
                  className={`px-4 py-2 border-l border-border transition-colors ${isMultiDay ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                >
                  Multiple Days
                </button>
              </div>

              {/* Date field(s) */}
              {isMultiDay ? (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl><Input type="date" min={startDate || undefined} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              ) : (
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {/* Time presets */}
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground font-medium">Quick presets:</span>
                {(["9to6", "10to7", "custom"] as const).map((p) => {
                  const label = p === "9to6" ? "9AM–6PM" : p === "10to7" ? "10AM–7PM" : "Custom";
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                        timePreset === p
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <TimePicker12h value={field.value} onChange={field.onChange} onCustomize={() => setTimePreset("custom")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <TimePicker12h value={field.value} onChange={field.onChange} onCustomize={() => setTimePreset("custom")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              {totalDays !== null && (
                <p className="text-xs text-indigo-600 font-semibold -mt-1">
                  {totalDays} day{totalDays !== 1 ? "s" : ""} · {formatTime12h(parseTime(startTime))} – {formatTime12h(parseTime(endTime))} IST
                </p>
              )}

              <SectionHeading>Perks & Benefits</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="foodProvided" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Food Provided</FormLabel>
                    <Select onValueChange={(v) => {
                      field.onChange(v);
                      if (v === "no") form.setValue("mealsProvided", undefined);
                    }} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {watchedFoodProvided === "yes" && (
                  <FormField control={form.control} name="mealsProvided" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meals Provided</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select meals..." /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1 Meal">1 Meal</SelectItem>
                          <SelectItem value="2 Meals">2 Meals</SelectItem>
                          <SelectItem value="3 Meals">3 Meals</SelectItem>
                          <SelectItem value="Snacks Only">Snacks Only</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
              <FormField control={form.control} name="incentives" render={({ field }) => (
                <FormItem>
                  <FormLabel>Incentives <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl><Input placeholder="e.g. ₹500 bonus on good performance" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="referralReward" render={({ field }) => (
                <FormItem>
                  <FormLabel>Referral Reward (₹) <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl><Input type="number" min="0" placeholder="e.g. 200" {...field} /></FormControl>
                  <p className="text-[11px] text-muted-foreground mt-1">Crew members earn this amount when someone they refer gets approved for this event.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="referralMessage" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <FormLabel className="mb-0">Referral Message <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <button
                      type="button"
                      onClick={() => {
                        if (field.value) {
                          setConfirmReplaceMsg(true);
                        } else {
                          field.onChange(generateReferralMessage(form.getValues(), roleConfigs));
                          setConfirmReplaceMsg(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg px-2.5 py-1.5 transition-colors shrink-0"
                    >
                      <Wand2 className="w-3 h-3" />
                      Generate Message
                    </button>
                  </div>
                  {confirmReplaceMsg && (
                    <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                      <p className="text-xs text-amber-800 font-medium">Replace existing message?</p>
                      <div className="flex gap-2 shrink-0">
                        <button type="button"
                          className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2"
                          onClick={() => {
                            field.onChange(generateReferralMessage(form.getValues(), roleConfigs));
                            setConfirmReplaceMsg(false);
                          }}>
                          Yes, replace
                        </button>
                        <button type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setConfirmReplaceMsg(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  <FormControl>
                    <Textarea
                      rows={7}
                      placeholder={`Hey 👋\n\nPaid event on Goteamcrew\n\nWork: [Role]\nGender: [Male/Female]\n📍 [Location]\n📅 [Date | Time] | 💰 [Pay]\n\nApply here 👇`}
                      className="resize-none text-sm leading-relaxed"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground mt-1">Generate a ready-to-send message based on event details. The referral link will be added automatically at the end.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <SectionHeading>Dress Code</SectionHeading>
              <FormField control={form.control} name="dressCode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Dress Code</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dressCodeImage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Dress Code Photo</FormLabel>
                  <FormControl>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-xl px-4 py-3 hover:bg-muted/30 transition-colors text-sm text-muted-foreground">
                        <span className="text-lg">📎</span>
                        <span>{field.value ? "Photo attached — click to change" : "Attach photo (JPG, PNG)"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) {
                              alert("Please use an image under 2 MB");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => field.onChange(reader.result as string);
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      {field.value && (
                        <div className="relative inline-block">
                          <img src={field.value} alt="Dress code" className="h-24 w-auto rounded-lg border border-border object-cover" />
                          <button
                            type="button"
                            onClick={() => field.onChange("")}
                            className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-rose-600"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <SectionHeading>Attendance Settings</SectionHeading>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
                {/* Check-in / Check-out row */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="expectedCheckIn" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Check-In</FormLabel>
                      <FormControl>
                        {field.value ? (
                          <div className="flex items-center gap-1">
                            <TimePicker12h compact value={field.value} onChange={field.onChange} />
                            <button type="button" onClick={() => field.onChange("")} className="text-[10px] text-muted-foreground hover:text-rose-500 px-1">✕</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => field.onChange("10:00")} className="h-8 px-3 text-xs rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full text-left">
                            Not set — tap to set
                          </button>
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="expectedCheckOut" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Check-Out</FormLabel>
                      <FormControl>
                        {field.value ? (
                          <div className="flex items-center gap-1">
                            <TimePicker12h compact value={field.value} onChange={field.onChange} />
                            <button type="button" onClick={() => field.onChange("")} className="text-[10px] text-muted-foreground hover:text-rose-500 px-1">✕</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => field.onChange("18:00")} className="h-8 px-3 text-xs rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full text-left">
                            Not set — tap to set
                          </button>
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Late threshold + Allowed break in one row */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="lateThresholdMinutes" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Late After (mins)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="Not set" className="h-8 text-sm rounded-xl" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="allowedBreakMinutes" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Break Limit (mins)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="Not set" className="h-8 text-sm rounded-xl" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Break window */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Break Window <span className="font-normal normal-case">(optional)</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="breakWindowStart" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">Start</FormLabel>
                        <FormControl>
                          {field.value ? (
                            <div className="flex items-center gap-1">
                              <TimePicker12h compact value={field.value} onChange={field.onChange} />
                              <button type="button" onClick={() => field.onChange("")} className="text-[10px] text-muted-foreground hover:text-rose-500 px-1">✕</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => field.onChange("13:00")} className="h-8 px-3 text-xs rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full text-left">
                              Not set
                            </button>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="breakWindowEnd" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">End</FormLabel>
                        <FormControl>
                          {field.value ? (
                            <div className="flex items-center gap-1">
                              <TimePicker12h compact value={field.value} onChange={field.onChange} />
                              <button type="button" onClick={() => field.onChange("")} className="text-[10px] text-muted-foreground hover:text-rose-500 px-1">✕</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => field.onChange("14:00")} className="h-8 px-3 text-xs rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full text-left">
                              Not set
                            </button>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </div>

              <SectionHeading>Notes</SectionHeading>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {showPreview && (
                <div className="bg-muted/40 rounded-xl p-3 border border-border/60 space-y-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Preview</p>
                  <p className="font-semibold text-foreground text-sm leading-snug">{watchedTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {watchedLocation}{primaryRole ? ` · ${primaryRole}` : ""}
                  </p>
                  {(() => {
                    const sd = startDate ? new Date(startDate + "T00:00:00") : null;
                    const ed = endDate ? new Date(endDate + "T00:00:00") : null;
                    const sdOk = sd && !isNaN(sd.getTime());
                    const edOk = ed && !isNaN(ed.getTime());
                    if (!sdOk) return null;
                    return (
                      <p className="text-xs text-muted-foreground">
                        {edOk && endDate !== startDate
                          ? `${format(sd, "MMM d")} – ${format(ed!, "MMM d, yyyy")}`
                          : format(sd, "MMM d, yyyy")}
                        {totalDays && totalDays > 1 ? ` · ${totalDays} day${totalDays !== 1 ? "s" : ""}` : ""}
                      </p>
                    );
                  })()}
                  {roleConfigs.some(c => c.payMale || c.payFemale) && (
                    <p className="text-xs text-primary font-semibold">
                      {(() => {
                        const parts: string[] = [];
                        for (const c of roleConfigs) {
                          const pm = payValToDisplay(c.payMale);
                          const pf = payValToDisplay(c.payFemale);
                          if (c.gender === "male" && pm) parts.push(pm);
                          else if (c.gender === "female" && pf) parts.push(pf);
                          else if (c.gender === "both") {
                            if (pm && pf && pm !== pf) parts.push(`M:${pm} F:${pf}`);
                            else if (pm) parts.push(pm);
                            else if (pf) parts.push(pf);
                          }
                        }
                        const str = parts.join(" · ");
                        return str ? `${str}/day` : "";
                      })()}
                    </p>
                  )}
                </div>
              )}

              {!isEditing && draftSaved && (
                <p className="text-center text-xs text-muted-foreground -mb-1">
                  ✓ Draft auto-saved
                </p>
              )}
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 border-amber-300 text-amber-700 hover:bg-amber-50"
                  disabled={savingDraft || isPending}
                  onClick={saveDraft}
                >
                  {savingDraft
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                    : <><BookMarked className="w-4 h-4 mr-2" />{isEditingDraft ? "Update Draft" : "Save as Draft"}</>
                  }
                </Button>
                <Button type="submit" className="flex-1 h-12" disabled={isPending || savingDraft}>
                  {isPending
                    ? (isEditingDraft ? "Publishing…" : isEditing ? "Saving changes..." : "Creating event...")
                    : isEditingDraft
                      ? <><Send className="w-4 h-4 mr-2" />Publish Event</>
                      : (isEditing ? "Save Changes" : "Save Event")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Referrals Dialog */}
      <Dialog open={referralsEventId !== null} onOpenChange={(o) => { if (!o) { setReferralsEventId(null); setReferralsData([]); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-violet-500" />
              Referrals — {referralsEventTitle}
            </DialogTitle>
            <DialogDescription>
              Review referrals for this event. Confirm to pay ₹100 to the referrer's wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {referralsLoading ? (
              <div className="py-10 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : referralsData.length === 0 ? (
              <div className="py-10 text-center">
                <Users2 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No referrals for this event yet.</p>
              </div>
            ) : (
              referralsData.map((r: any) => {
                const statusColors: Record<string, string> = {
                  pending: "bg-amber-50 text-amber-700 border-amber-200",
                  selected: "bg-indigo-50 text-indigo-700 border-indigo-200",
                  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  rejected: "bg-red-50 text-red-700 border-red-200",
                };
                const color = statusColors[r.status] || statusColors.pending;
                const isActing = referralActionId === r.id;
                return (
                  <div key={r.id} className="border border-border/60 rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
                          {r.referrerName || "Unknown referrer"}
                        </p>
                        {r.referredUserName ? (
                          <p className="text-xs text-muted-foreground">Referred: {r.referredUserName}</p>
                        ) : r.referredPhone ? (
                          <p className="text-xs text-muted-foreground">Phone: {r.referredPhone}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No one registered yet</p>
                        )}
                        {r.rewardAmount && parseFloat(r.rewardAmount) > 0 && (
                          <p className="text-xs text-violet-700 font-medium">
                            Reward: ₹{parseFloat(r.rewardAmount).toLocaleString("en-IN")}
                            {r.rewardPaid === "yes" ? " — Paid" : ""}
                          </p>
                        )}
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${color} whitespace-nowrap`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </div>

                    {r.status === "selected" && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          className="flex-1 h-8 rounded-lg text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                          disabled={isActing}
                          onClick={() => handleReferralAction(r.id, "confirm")}
                        >
                          {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Confirm & Pay ₹100
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 rounded-lg text-xs gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          disabled={isActing}
                          onClick={() => handleReferralAction(r.id, "reject")}
                        >
                          {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm-close dialog for the Create/Edit modal */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Closing now will lose all the information you've entered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmClose(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                try { localStorage.removeItem(DRAFT_KEY); } catch {}
                setConfirmClose(false);
                setOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard &amp; close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDraftId !== null} onOpenChange={(o) => { if (!o) setDeleteDraftId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft will be permanently deleted and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDraftId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteDraft}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Unlock Event Modal ───────────────────────────────────── */}
      <Dialog open={unlockEvent !== null} onOpenChange={(o) => { if (!o) { setUnlockEvent(null); setUnlockPassword(""); setUnlockPasswordError(""); } }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              🔓 Unlock Event
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              <strong>"{unlockEvent?.title}"</strong> is locked due to{" "}
              <strong>{unlockEvent?.reason === "payment" ? "completed payment" : "event completion"}</strong>.
              Enter your admin password to unlock and allow edits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Admin password</label>
              <Input
                type="password"
                placeholder="Your password"
                value={unlockPassword}
                onChange={(e) => { setUnlockPassword(e.target.value); setUnlockPasswordError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleUnlock(); }}
                className="rounded-xl"
                autoFocus
              />
              {unlockPasswordError && (
                <p className="text-xs text-rose-600 font-medium">{unlockPasswordError}</p>
              )}
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 font-medium">
              ⚠️ After unlocking, the event may re-lock automatically if conditions still apply.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-10 rounded-xl"
                onClick={() => { setUnlockEvent(null); setUnlockPassword(""); setUnlockPasswordError(""); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                disabled={isUnlocking}
                onClick={handleUnlock}
              >
                {isUnlocking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Unlock Event
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Manage Event Deletion Modal ──────────────────────────── */}
      <Dialog open={deleteModalEvent !== null} onOpenChange={(o) => { if (!o) setDeleteModalEvent(null); }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <span className="text-amber-500">⚠️</span> Manage Event Deletion
            </DialogTitle>
            <DialogDescription>
              Choose an action for <strong>"{deleteModalEvent?.title}"</strong>. Archive is reversible. Permanent delete will erase all data.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            <Button
              className="h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold"
              disabled={isArchiving}
              onClick={handleArchive}
            >
              {isArchiving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Archive Event (Safe)
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-semibold"
              onClick={() => deleteModalEvent && openPermDelete(deleteModalEvent)}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Permanently (Danger)
            </Button>
            <Button variant="ghost" className="h-10 rounded-xl" onClick={() => setDeleteModalEvent(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Permanent Delete Modal ───────────────────────── */}
      <Dialog open={permDeleteEvent !== null} onOpenChange={(o) => { if (!o) { setPermDeleteEvent(null); setDeletePassword(""); setDeletePasswordError(""); } }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Confirm Permanent Deletion
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              This will permanently delete <strong>"{permDeleteEvent?.title}"</strong> and ALL related data: attendance, check-in/out, referrals, payments, claims. <strong>This cannot be undone.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Enter your admin password to confirm</label>
              <Input
                type="password"
                placeholder="Your password"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setDeletePasswordError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handlePermDelete(); }}
                className="rounded-xl"
                autoFocus
              />
              {deletePasswordError && (
                <p className="text-xs text-rose-600 font-medium">{deletePasswordError}</p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-10 rounded-xl"
                onClick={() => { setPermDeleteEvent(null); setDeletePassword(""); setDeletePasswordError(""); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
                disabled={isPermDeleting}
                onClick={handlePermDelete}
              >
                {isPermDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete Permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingPayload !== null} onOpenChange={(o) => { if (!o) setPendingPayload(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changing Event Date?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the event date will reset all attendance records (check-ins, selfies, GPS data, approvals) for every shift in this event. Crew members will need to check in again on the new date. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPayload(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                if (!pendingPayload) return;
                const formValues = form.getValues();
                doUpdate(pendingPayload.id, pendingPayload.data, formValues.role, formValues);
                setPendingPayload(null);
              }}
            >
              Yes, Change Date & Clear Attendance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
