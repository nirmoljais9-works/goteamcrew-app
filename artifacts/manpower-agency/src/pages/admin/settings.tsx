import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function AdminSettings() {
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [show, setShow] = useState({ current: false, new: false, confirm: false });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggle = (field: keyof typeof show) =>
    setShow(prev => ({ ...prev, [field]: !prev[field] }));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.currentPassword) errs.currentPassword = "Current password is required";
    if (!form.newPassword) errs.newPassword = "New password is required";
    else if (form.newPassword.length < 8) errs.newPassword = "Must be at least 8 characters";
    if (!form.confirmPassword) errs.confirmPassword = "Please confirm your new password";
    else if (form.newPassword !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
    if (form.newPassword && form.currentPassword && form.newPassword === form.currentPassword)
      errs.newPassword = "New password must differ from current password";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Password updated", description: "Your password has been changed successfully." });
        setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setErrors({});
      } else if (res.status === 401 && data.code === "WRONG_PASSWORD") {
        setErrors({ currentPassword: "Incorrect current password" });
      } else {
        toast({ variant: "destructive", title: "Failed", description: data.error || "Something went wrong" });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Could not connect. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const PasswordField = ({
    id, label, field, showKey,
  }: {
    id: string; label: string; field: keyof typeof form; showKey: keyof typeof show;
  }) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show[showKey] ? "text" : "password"}
          value={form[field]}
          onChange={e => {
            setForm(prev => ({ ...prev, [field]: e.target.value }));
            if (errors[field]) setErrors(prev => ({ ...prev, [field]: "" }));
          }}
          className={`h-11 pr-10 ${errors[field] ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
          placeholder="••••••••"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => toggle(showKey)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          tabIndex={-1}
        >
          {show[showKey] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {errors[field] && <p className="text-xs text-destructive">{errors[field]}</p>}
    </div>
  );

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your admin account security</p>
      </div>

      <div className="bg-card rounded-xl border border-border/60 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/30">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Change Password</p>
            <p className="text-xs text-muted-foreground">Update your login password</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <PasswordField
            id="currentPassword"
            label="Current Password"
            field="currentPassword"
            showKey="current"
          />

          <div className="border-t border-border/40 pt-5 space-y-5">
            <PasswordField
              id="newPassword"
              label="New Password"
              field="newPassword"
              showKey="new"
            />

            <PasswordField
              id="confirmPassword"
              label="Confirm New Password"
              field="confirmPassword"
              showKey="confirm"
            />
          </div>

          {/* Password strength hint */}
          {form.newPassword && (
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Password requirements</p>
              <ul className="text-xs space-y-1">
                {[
                  { ok: form.newPassword.length >= 8, label: "At least 8 characters" },
                  { ok: /[A-Z]/.test(form.newPassword), label: "One uppercase letter" },
                  { ok: /[0-9]/.test(form.newPassword), label: "One number" },
                  { ok: /[^A-Za-z0-9]/.test(form.newPassword), label: "One special character" },
                ].map(({ ok, label }) => (
                  <li key={label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-600" : "text-muted-foreground"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-11 gap-2"
            disabled={isLoading}
          >
            <ShieldCheck className="w-4 h-4" />
            {isLoading ? "Updating password…" : "Update Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
