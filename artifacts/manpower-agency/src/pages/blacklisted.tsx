import { ShieldX, Mail } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function Blacklisted() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md text-center space-y-6"
      >
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
            <ShieldX className="w-10 h-10 text-red-600" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-display font-bold text-foreground">Access Restricted</h1>
          <p className="text-muted-foreground leading-relaxed">
            You are currently not allowed to access Goteamcrew due to policy restrictions.
            If you believe this is a mistake, please contact our support team.
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-800 font-medium flex items-center gap-2 justify-center">
          <ShieldX className="w-4 h-4 shrink-0" />
          Status: ❌ Blacklisted
        </div>

        <a
          href="mailto:info@goteamcrew.in"
          className="inline-flex items-center gap-2 justify-center w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          <Mail className="w-4 h-4" />
          Contact Support — info@goteamcrew.in
        </a>

        <Link href="/">
          <Button variant="ghost" className="w-full text-muted-foreground">
            Return to Homepage
          </Button>
        </Link>
      </motion.div>
    </div>
  );
}
