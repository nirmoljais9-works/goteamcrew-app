import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { CheckCircle2, RefreshCw } from "lucide-react";

export default function RegisterSuccess() {
  const search = useSearch();
  const isReapply = new URLSearchParams(search).get("reapplied") === "true";

  useEffect(() => {
    sessionStorage.setItem("justSubmitted", "true");
  }, []);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-card rounded-[2rem] p-8 sm:p-12 shadow-xl border border-border/50 text-center"
      >
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${isReapply ? "bg-blue-100" : "bg-green-100"}`}>
          {isReapply
            ? <RefreshCw className="w-10 h-10 text-blue-600" />
            : <CheckCircle2 className="w-10 h-10 text-green-600" />
          }
        </div>

        <h1 className="text-3xl font-display font-bold text-foreground mb-4">
          {isReapply ? "Reapplication Submitted!" : "Application Submitted!"}
        </h1>

        <p className="text-muted-foreground mb-6 leading-relaxed">
          {isReapply
            ? "Your updated profile is under review. We'll notify you on WhatsApp once it's approved."
            : <>Your profile is under review.<br />We'll notify you on WhatsApp once your profile is approved.</>
          }
        </p>

        {isReapply && (
          <div className="bg-blue-50 rounded-xl p-4 mb-6 border border-blue-100 text-left">
            <p className="text-sm font-semibold text-blue-800 mb-1">What changed?</p>
            <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>Your previous data has been replaced with the new information</li>
              <li>Status reset to <span className="font-semibold">Pending Review</span></li>
              <li>New photos and documents saved</li>
            </ul>
          </div>
        )}

        <div className="bg-primary/5 rounded-xl p-4 mb-8 border border-primary/10">
          <p className="text-sm font-medium text-primary">
            Typical review time: 2–3 business days
          </p>
        </div>

        <div className="space-y-4">
          <Link href="/">
            <Button className="w-full h-12 rounded-xl text-lg shadow-md" variant="default">
              Back to Home
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
