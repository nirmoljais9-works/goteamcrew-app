import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowLeft, Eye, EyeOff, Loader2, Mail, Phone, X } from "lucide-react";

const SUPPORT_EMAIL = "info@goteamcrew.in";
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v: string) => /^\d{10}$/.test(v);

const formSchema = z.object({
  phone: z.string().min(1, "Enter your phone number or email").refine(
    (v) => isPhone(v) || isEmail(v),
    "Enter a valid 10-digit number or email address"
  ),
  password: z.string().min(1, "Password is required"),
});

function resolveRedirect(storedPath: string | null, role: string): string {
  if (!storedPath || storedPath === "/login") {
    return role === "admin" ? "/admin" : "/dashboard";
  }
  if (role === "admin" && (storedPath.startsWith("/admin") || storedPath === "/")) {
    return storedPath;
  }
  if (role === "crew" && !storedPath.startsWith("/admin")) {
    return storedPath;
  }
  return role === "admin" ? "/admin" : "/dashboard";
}

// ── Forgot Password Modal ─────────────────────────────────────────────────────
function ForgotPasswordModal({ open, onClose, initialPhone }: {
  open: boolean;
  onClose: () => void;
  initialPhone: string;
}) {
  const { toast } = useToast();
  const [step, setStep]           = useState<"form" | "otp">("form");
  const [phone, setPhone]         = useState(initialPhone);
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [showCf, setShowCf]       = useState(false);
  const [formError, setFormError] = useState("");
  const [sending, setSending]     = useState(false);
  const [otp, setOtp]             = useState("");
  const [otpError, setOtpError]   = useState("");
  const [otpTimer, setOtpTimer]   = useState(0);
  const [cooldown, setCooldown]   = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const otpInputRef  = useRef<HTMLInputElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open) {
      setStep("form");
      setPhone(initialPhone);
      setPassword(""); setConfirm(""); setFormError("");
      setOtp(""); setOtpError(""); setOtpTimer(0); setCooldown(0);
      setSending(false); setVerifying(false); setResending(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [open, initialPhone]);

  const startTimer = (secs = 30) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setOtpTimer(secs);
    timerRef.current = setInterval(() => setOtpTimer(t => { if (t <= 1) { clearInterval(timerRef.current!); return 0; } return t - 1; }), 1000);
  };

  const startCooldown = (secs = 30) => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(secs);
    cooldownRef.current = setInterval(() => setCooldown(c => { if (c <= 1) { clearInterval(cooldownRef.current!); return 0; } return c - 1; }), 1000);
  };

  const doSendOTP = (identifier: string) => {
    console.log("[OTP] doSendOTP called — identifier:", identifier, "widgetId: 36646f674475303238343136");
    // @ts-ignore
    window.initSendOTP({
      widgetId: "36646f674475303238343136",
      tokenAuth: "508849TqFl2WeiaRJg69df3ff5P1",
      identifier,
      exposeMethods: true,
      success: () => {
        console.log("[OTP] initSendOTP success callback fired");
      },
      failure: (_err: unknown) => {
        console.error("[OTP] initSendOTP FAILURE:", JSON.stringify(_err), _err);
        setOtpError("Verification failed. Please try again.");
        setVerifying(false);
      },
    });
    console.log("[OTP] initSendOTP invoked — waiting for MSG91 response");
    setSending(false);
    startTimer(30);
    startCooldown(30);
    setStep("otp");
    setOtp(""); setOtpError("");
    setTimeout(() => otpInputRef.current?.focus(), 150);
  };

  const sendOTP = async () => {
    const digits = phone.replace(/\D/g, "").slice(0, 10);
    if (digits.length !== 10)  { setFormError("Enter a valid 10-digit phone number"); return; }
    if (password.length < 6)   { setFormError("Password must be at least 6 characters"); return; }
    if (password !== confirm)  { setFormError("Passwords do not match"); return; }
    setFormError("");
    setSending(true);

    // ── Verify account exists before sending OTP (POST = never cached) ────────
    try {
      const checkRes = await fetch(`${BASE_URL}/api/auth/check-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const checkData = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) {
        setSending(false);
        setFormError(checkData.error || "No account found with this mobile number. Please check your number.");
        return;
      }
    } catch {
      setSending(false);
      setFormError("Could not verify your account. Please check your connection.");
      return;
    }

    const identifier = `91${digits}`;
    // @ts-ignore
    if (typeof window.initSendOTP === "function") { doSendOTP(identifier); return; }
    const urls = ["https://verify.msg91.com/otp-provider.js", "https://verify.phone91.com/otp-provider.js"];
    let idx = 0;
    const tryNext = () => {
      if (idx >= urls.length) {
        setSending(false);
        toast({ variant: "destructive", title: "OTP service unavailable", description: "Please check your connection and try again." });
        return;
      }
      const s = document.createElement("script");
      s.src = urls[idx]; s.async = true;
      // @ts-ignore
      s.onload = () => { if (typeof window.initSendOTP === "function") doSendOTP(identifier); else { idx++; tryNext(); } };
      s.onerror = () => { idx++; tryNext(); };
      document.head.appendChild(s);
    };
    tryNext();
  };

  const submitOtp = (code?: string) => {
    const val = code ?? otp;
    if (val.length !== 4) { setOtpError("Enter the 4-digit OTP"); return; }
    setVerifying(true); setOtpError("");
    // @ts-ignore
    if (typeof window.verifyOtp !== "function") {
      setVerifying(false); setOtpError("Verification service error. Please retry."); return;
    }
    // @ts-ignore
    window.verifyOtp(val,
      async () => {
        try {
          const res = await fetch(`${BASE_URL}/api/auth/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, newPassword: password }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Failed to reset password");
          toast({ title: "Password changed successfully", description: "You can now sign in with your new password." });
          onClose();
        } catch (e: any) {
          setOtpError(e?.message || "Failed to update password. Please try again.");
          setVerifying(false);
        }
      },
      (_err: unknown) => {
        setVerifying(false);
        setOtpError("Incorrect OTP. Please try again.");
        setOtp("");
        setTimeout(() => otpInputRef.current?.focus(), 50);
      }
    );
  };

  const resendOTP = () => {
    if (otpTimer > 0 || resending || cooldown > 0) return;
    setResending(true); setOtp(""); setOtpError("");
    const identifier = `91${phone.replace(/\D/g, "").slice(0, 10)}`;
    // @ts-ignore
    if (typeof window.retryOtp === "function") {
      // @ts-ignore
      window.retryOtp(
        () => { setResending(false); startTimer(30); startCooldown(30); },
        () => { setResending(false); setOtpError("Failed to resend OTP. Try again."); }
      );
    // @ts-ignore
    } else if (typeof window.initSendOTP === "function") {
      doSendOTP(identifier);
      setResending(false);
    } else {
      setResending(false); setOtpError("OTP service unavailable. Please try again.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="w-full sm:max-w-sm bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          {step === "otp" ? (
            <button onClick={() => { setStep("form"); setOtp(""); setOtpError(""); if (timerRef.current) clearInterval(timerRef.current); }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : <div className="w-7" />}
          <h2 className="text-sm font-semibold text-foreground">
            {step === "form" ? "Reset Password" : "Verify OTP"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 -mr-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-6 space-y-4">
          {step === "form" && (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enter your registered phone number and choose a new password. We'll verify your identity with an OTP.
              </p>

              {/* Phone */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">Phone number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="tel" inputMode="numeric" maxLength={10}
                    placeholder="10-digit mobile number"
                    value={phone}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setFormError(""); }}
                    className="w-full h-12 pl-9 pr-4 rounded-xl bg-muted/50 border border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-sm outline-none"
                  />
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    placeholder="Min 6 characters"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setFormError(""); }}
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-muted/50 border border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-sm outline-none"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">Confirm password</label>
                <div className="relative">
                  <input
                    type={showCf ? "text" : "password"}
                    placeholder="Re-enter new password"
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setFormError(""); }}
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-muted/50 border border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-sm outline-none"
                  />
                  <button type="button" onClick={() => setShowCf(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1">
                    {showCf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {formError && (
                <p className="text-xs text-red-500 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {formError}
                </p>
              )}

              <Button className="w-full h-12 rounded-xl text-sm font-semibold gap-2" onClick={sendOTP} disabled={sending}>
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending OTP…</> : "Send OTP"}
              </Button>
            </>
          )}

          {step === "otp" && (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enter the OTP sent to <strong className="text-foreground">+91 {phone}</strong>
              </p>

              {/* 4-box OTP input */}
              <div className="relative">
                <input
                  ref={otpInputRef}
                  type="tel" inputMode="numeric"
                  value={otp} maxLength={4}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setOtp(val); setOtpError("");
                    if (val.length === 4) submitOtp(val);
                  }}
                  className="absolute inset-0 opacity-0 cursor-text w-full h-full"
                  autoFocus
                />
                <div className="flex gap-3 justify-center" onClick={() => otpInputRef.current?.focus()}>
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all select-none
                      ${otp.length === i && !verifying ? "border-primary bg-primary/5 shadow-sm" : otp[i] ? "border-primary/40 bg-muted/30" : "border-border bg-muted/30"}`}>
                      {otp[i] ?? ""}
                    </div>
                  ))}
                </div>
              </div>

              {otpError && (
                <p className="text-xs text-red-500 font-medium text-center">{otpError}</p>
              )}
              {verifying && (
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying…
                </p>
              )}

              <Button
                className="w-full h-12 rounded-xl text-sm font-semibold gap-2"
                onClick={() => submitOtp()}
                disabled={otp.length < 4 || verifying}
              >
                {verifying
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  : "Change Password"}
              </Button>

              {/* Resend */}
              <div className="text-center pt-1">
                {otpTimer > 0 ? (
                  <p className="text-xs text-muted-foreground">Resend OTP in <strong className="tabular-nums">{otpTimer}s</strong></p>
                ) : (
                  <button
                    onClick={resendOTP}
                    disabled={resending || cooldown > 0}
                    className="text-xs text-primary font-semibold hover:underline disabled:opacity-50 disabled:no-underline transition-opacity"
                  >
                    {resending ? "Resending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [accountRemoved, setAccountRemoved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fpOpen, setFpOpen] = useState(false);
  const [fpChecking, setFpChecking] = useState(false);
  const [fpError, setFpError] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phone: "", password: "" },
  });

  useEffect(() => {
    if (user) {
      const stored = sessionStorage.getItem("loginRedirect");
      sessionStorage.removeItem("loginRedirect");
      setLocation(resolveRedirect(stored, user.role));
    }
  }, [user, setLocation]);

  const loginMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: values.phone, password: values.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { status: res.status, data };
      return data;
    },
    onSuccess: (data) => {
      // Populate the auth cache first. Navigation is intentionally deferred
      // to the useEffect([user]) below, which fires only after React Query has
      // propagated the updated user to the AuthProvider's useGetMe observer.
      // Calling setLocation here (before propagation) causes ProtectedRoute to
      // render with user=null and immediately redirect back to /login.
      queryClient.setQueryData(["/api/auth/me"], data);
      toast({ title: "Welcome back!", description: "Successfully logged in." });
    },
    onError: (error: any) => {
      const code = error?.data?.code;
      if (code === "REMOVED") {
        setAccountRemoved(true);
      } else {
        setAccountRemoved(false);
        toast({
          variant: "destructive",
          title: "Login failed",
          description: error?.data?.error || "Invalid phone number or password.",
        });
      }
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setAccountRemoved(false);
    loginMutation.mutate(values);
  };

  const handleForgotPassword = async () => {
    setFpError("");
    const raw = form.getValues("phone");
    const digits = raw.replace(/\D/g, "").slice(0, 10);

    if (digits.length !== 10) {
      setFpError("Enter your 10-digit mobile number above first, then click Forgot password.");
      return;
    }

    setFpChecking(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/check-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFpError(data.error || "No account found with this mobile number.");
        return;
      }
      setFpOpen(true);
    } catch {
      setFpError("Could not verify your account. Please check your connection.");
    } finally {
      setFpChecking(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      <div className="hidden md:block relative bg-sidebar overflow-hidden">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-side.png`}
          alt="Event atmosphere"
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/50 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-sidebar-foreground">
          <h2 className="font-display font-bold text-4xl mb-4">Goteamcrew Portal</h2>
          <p className="text-sidebar-foreground/70 text-lg">
            Manage your shifts, track your earnings, and advance your career in the event industry.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-background">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center">
            <Link href="/">
              <img
                src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`}
                alt="Goteamcrew"
                className="h-16 w-auto object-contain mx-auto mb-4 hover:opacity-80 transition-opacity cursor-pointer"
              />
            </Link>
            <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="text-muted-foreground mt-2">Enter your credentials to access your account</p>
          </div>

          <AnimatePresence>
            {accountRemoved && (
              <motion.div
                key="removed-alert"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-red-800">Account Removed</p>
                    <p className="text-sm text-red-700 leading-relaxed">
                      Your account has been removed by the admin.
                    </p>
                    <p className="text-sm text-red-700 leading-relaxed">
                      If you believe this is a mistake or need further assistance, please contact us at{" "}
                      <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        className="font-semibold underline underline-offset-2 hover:text-red-900 transition-colors"
                      >
                        {SUPPORT_EMAIL}
                      </a>
                    </p>
                  </div>
                </div>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=Account%20Removed%20-%20Assistance%20Required`}
                  className="flex items-center justify-center gap-2 w-full rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-700 font-medium text-sm py-2 px-4 transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Contact Support
                </a>
              </motion.div>
            )}
          </AnimatePresence>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-semibold">Phone number</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="10-digit mobile number"
                          type="text"
                          inputMode="email"
                          autoComplete="username"
                          autoCorrect="off"
                          autoCapitalize="none"
                          className="h-12 rounded-xl bg-muted/50 border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all pl-9"
                          {...field}
                          onChange={(e) => {
                            const raw = e.target.value;
                            // If it looks like an email (has @ or letters), pass through; otherwise digits-only max 10
                            if (raw.includes("@") || /[a-zA-Z]/.test(raw)) {
                              field.onChange(raw.trim());
                            } else {
                              field.onChange(raw.replace(/\D/g, "").slice(0, 10));
                            }
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-foreground font-semibold">Password</FormLabel>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={fpChecking}
                        className="text-sm font-medium text-primary hover:underline disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {fpChecking && <Loader2 className="w-3 h-3 animate-spin" />}
                        Forgot password?
                      </button>
                    </div>
                    {fpError && (
                      <p className="text-xs text-red-500 font-medium flex items-start gap-1.5 pt-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {fpError}
                      </p>
                    )}
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Password"
                          autoComplete="current-password"
                          className="h-12 rounded-xl bg-muted/50 border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all pr-12"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                          tabIndex={-1}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full h-12 text-lg rounded-xl shadow-md"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>

          <p className="text-center text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/register" className="font-semibold text-primary hover:underline">
              Apply to join
            </Link>
          </p>
        </motion.div>
      </div>

      <AnimatePresence>
        {fpOpen && (
          <ForgotPasswordModal
            open={fpOpen}
            onClose={() => setFpOpen(false)}
            initialPhone={form.getValues("phone")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
