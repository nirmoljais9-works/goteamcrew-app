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
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Mail, Eye, EyeOff, Phone } from "lucide-react";

const SUPPORT_EMAIL = "info@goteamcrew.in";

const formSchema = z.object({
  phone: z.string().min(6, "Please enter your phone number"),
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

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [accountRemoved, setAccountRemoved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) {
      const stored = sessionStorage.getItem("loginRedirect");
      sessionStorage.removeItem("loginRedirect");
      setLocation(resolveRedirect(stored, user.role));
    }
  }, [user, setLocation]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phone: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
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
      queryClient.setQueryData(["/api/auth/me"], data);
      toast({ title: "Welcome back!", description: "Successfully logged in." });
      const stored = sessionStorage.getItem("loginRedirect");
      sessionStorage.removeItem("loginRedirect");
      setLocation(resolveRedirect(stored, data.role));
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
                          placeholder="Enter your phone number"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          autoCorrect="off"
                          className="h-12 rounded-xl bg-muted/50 border-transparent focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all pl-9"
                          {...field}
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
                      <span className="text-sm font-medium text-primary hover:underline cursor-pointer">
                        Forgot password?
                      </span>
                    </div>
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
    </div>
  );
}
