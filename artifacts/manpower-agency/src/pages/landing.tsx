import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { ArrowRight, Star, Zap, Phone, Mail, MapPin, Plane, Camera, Briefcase, TrendingUp, Clock, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";

const benefits = [
  { icon: Briefcase, label: "Earn Good Money", color: "bg-primary text-white" },
  { icon: Plane, label: "Get to Travel", color: "bg-sky-400 text-sky-900" },
  { icon: TrendingUp, label: "Future Opportunities", color: "bg-violet-400 text-violet-900" },
  { icon: Camera, label: "Experience & Exposure", color: "bg-rose-400 text-rose-900" },
  { icon: Clock, label: "Part-Time Flexible", color: "bg-emerald-400 text-emerald-900" },
];

const stats = [
  { value: "5000+", label: "Students Placed" },
  { value: "100+", label: "Brands Worked With" },
  { value: "20+", label: "Cities" },
  { value: "500+", label: "Events Done" },
];

const categories = [
  { name: "Promoters", icon: "📢", desc: "Brand promotion at malls, launches, fests" },
  { name: "Hostesses", icon: "🤝", desc: "Welcome guests at corporate & social events" },
  { name: "Models", icon: "✨", desc: "Fashion shows, product shoots, exhibitions" },
  { name: "Anchors", icon: "🎤", desc: "Host events, shows, and corporate functions" },
  { name: "Event Crew", icon: "⚡", desc: "Setup, coordination, operations support" },
];

const steps = [
  { step: "01", icon: "📝", title: "Register Free", desc: "Fill your profile in 5 minutes. Upload your photos. No fees, no experience needed." },
  { step: "02", icon: "✅", title: "Get Approved", desc: "Our team reviews and calls you on WhatsApp for upcoming gigs near you." },
  { step: "03", icon: "💰", title: "Work & Earn", desc: "Show up, do your job, and get paid directly. Repeat with better gigs each time." },
];

const perks = [
  { icon: CheckCircle, text: "Open to freshers — no experience required" },
  { icon: CheckCircle, text: "Flexible hours — work on weekends only if you want" },
  { icon: CheckCircle, text: "Direct payments — no middlemen" },
  { icon: CheckCircle, text: "Work with top brands and corporates" },
  { icon: CheckCircle, text: "Build your portfolio & confidence" },
  { icon: CheckCircle, text: "Opportunities across India" },
];

export default function Landing() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      // If the user just submitted their application, let them see the landing
      // page instead of bouncing straight to the pending/dashboard screen.
      const justSubmitted = sessionStorage.getItem("justSubmitted");
      if (justSubmitted) {
        sessionStorage.removeItem("justSubmitted");
        return; // stay on landing
      }
      setLocation(user.role === "admin" ? "/admin" : "/dashboard");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return <div className="h-screen w-full flex items-center justify-center bg-background"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="min-h-screen bg-background font-sans">

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 px-4 py-3 lg:px-8 flex justify-between items-center bg-white/90 backdrop-blur-md border-b border-border/40 shadow-sm">
        <img
          src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`}
          alt="Goteamcrew"
          className="h-11 w-auto object-contain"
        />
        <div className="hidden md:flex items-center gap-8 font-medium text-muted-foreground text-sm">
          <a href="#earn" className="hover:text-primary transition-colors">Why Join</a>
          <a href="#how" className="hover:text-primary transition-colors">How It Works</a>
          <a href="#categories" className="hover:text-primary transition-colors">Categories</a>
          <a href="#contact" className="hover:text-primary transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" className="font-semibold text-muted-foreground hover:text-primary hidden sm:inline-flex rounded-full text-sm">
              Login
            </Button>
          </Link>
          <Link href="/register">
            <Button className="font-semibold rounded-full px-5 shadow-md bg-primary hover:bg-primary/90 text-white text-sm">
              Join as Crew ✨
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background pt-16">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-accent/5 via-transparent to-transparent pointer-events-none" />


        <div className="relative z-10 container max-w-4xl mx-auto px-4 sm:px-6 text-center py-16">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/40 text-primary font-semibold text-xs mb-6 tracking-wide uppercase">
              <Star className="w-3.5 h-3.5 fill-violet-400 text-violet-400" />
              Open for College Students & Freshers
            </div>

            <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-extrabold text-foreground leading-tight mb-4">
              Earn Money
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                Working in Events
              </span>
            </h1>

            <p className="text-muted-foreground text-lg sm:text-xl mb-3 max-w-2xl mx-auto leading-relaxed">
              Join Goteamcrew and work as a promoter, hostess, model, or anchor at top events across India.
            </p>
            <p className="text-muted-foreground text-base mb-8 max-w-xl mx-auto">
              No experience needed. Flexible schedule. Direct payment. 🎉
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto text-base px-10 h-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 text-white font-bold hover:-translate-y-1 transition-all duration-300">
                  Join as Crew <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 h-14 rounded-full border-border text-muted-foreground hover:bg-muted font-semibold">
                  Already registered? Login
                </Button>
              </Link>
            </div>

            {/* Benefit badges — centered flex-wrap, no absolute positioning */}
            <div className="flex flex-wrap justify-center items-center gap-2.5 mt-10">
              {benefits.map((b, i) => (
                <motion.span
                  key={b.label}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.08, duration: 0.35, type: "spring" }}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 h-8 rounded-full ${b.color} font-semibold text-xs shadow-md whitespace-nowrap`}
                >
                  <b.icon className="w-3.5 h-3.5 shrink-0" />
                  {b.label}
                </motion.span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>


      {/* Why Join — Perks */}
      <section id="earn" className="py-20 bg-white">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-wider mb-4">
                <Zap className="w-3.5 h-3.5" /> Why College Students Love Us
              </div>
              <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-foreground mb-6 leading-tight">
                The perfect <span className="text-primary">side hustle</span> for students
              </h2>
              <p className="text-muted-foreground text-lg mb-8">Work on weekends, semester breaks, or whenever you're free. Build real-world experience and grow your confidence.</p>
              <ul className="space-y-3">
                {perks.map((p, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 text-foreground">
                    <p.icon className="w-5 h-5 text-emerald-500 shrink-0" />
                    <span className="font-medium">{p.text}</span>
                  </motion.li>
                ))}
              </ul>
              <Link href="/register">
                <Button className="mt-8 rounded-full px-8 h-12 bg-primary hover:bg-primary/90 text-white font-semibold">
                  I'm Interested — Join as Crew <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { emoji: "🎪", title: "Brand Events", desc: "Work for top FMCG brands, tech companies, and startups" },
                { emoji: "🏨", title: "Hotels & Venues", desc: "Corporate events, weddings, and private parties" },
                { emoji: "🎓", title: "College Fests", desc: "Inter-college events, cultural fests, and sports meets" },
                { emoji: "🛍️", title: "Mall Activations", desc: "Product launches, brand promotions, samplings" },
              ].map((card, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                  className="bg-muted/40 border border-border/50 rounded-2xl p-5 hover:shadow-md transition-shadow">
                  <div className="text-3xl mb-3">{card.emoji}</div>
                  <div className="font-bold text-sm text-foreground mb-1">{card.title}</div>
                  <div className="text-xs text-muted-foreground">{card.desc}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" className="py-20 bg-slate-950">
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/70 text-xs font-bold uppercase tracking-wider mb-4">
            Simple Process
          </div>
          <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-white mb-4">Start working in 3 steps</h2>
          <p className="text-slate-400 text-lg mb-14 max-w-xl mx-auto">The whole process takes less than 5 minutes.</p>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center hover:bg-white/10 transition-colors">
                <div className="text-5xl mb-4">{s.icon}</div>
                <div className="text-primary font-bold text-xs uppercase tracking-widest mb-2">Step {s.step}</div>
                <h3 className="text-white font-bold text-xl mb-3">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>

          <Link href="/register">
            <Button size="lg" className="mt-12 text-base px-12 h-14 rounded-full bg-primary hover:bg-primary/90 text-white font-bold shadow-xl hover:-translate-y-1 transition-all duration-300">
              Register Free — Takes 5 Mins <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="py-20 bg-white">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-foreground mb-3">Pick your role</h2>
            <p className="text-muted-foreground text-lg">We have opportunities across 5 categories for all personalities.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {categories.map((cat, i) => (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className="flex items-start gap-4 p-6 rounded-2xl border border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-default group">
                <div className="text-4xl">{cat.icon}</div>
                <div>
                  <div className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{cat.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">{cat.desc}</div>
                </div>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
              className="flex items-center justify-center p-6 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-center">
              <div>
                <div className="text-4xl mb-2">🚀</div>
                <div className="font-bold text-primary">More coming soon</div>
                <div className="text-xs text-muted-foreground mt-1">Register and we'll match you</div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Testimonial-style social proof */}
      <section className="py-16 bg-gradient-to-r from-violet-600 to-indigo-600">
        <div className="container max-w-5xl mx-auto px-4 text-center">
          <div className="text-white/80 text-sm font-bold uppercase tracking-widest mb-4">What our crew says</div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { quote: "Got to work at a huge college fest and it was an amazing experience. Highly recommend!", name: "Priya S.", city: "Mumbai", role: "Hostess" },
              { quote: "Got to work at a tech conference and made great connections. Highly recommend!", name: "Rahul K.", city: "Bangalore", role: "Promoter" },
              { quote: "Perfect for students. Flexible timings and instant payment after the event.", name: "Neha M.", city: "Delhi", role: "Anchor" },
            ].map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6 text-left">
                <div className="flex mb-3">
                  {[...Array(5)].map((_, j) => <Star key={j} className="w-4 h-4 fill-violet-400 text-violet-400" />)}
                </div>
                <p className="text-white text-sm leading-relaxed mb-4">"{t.quote}"</p>
                <div>
                  <div className="text-white font-bold text-sm">{t.name}</div>
                  <div className="text-white/60 text-xs">{t.role} · {t.city}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-white">
        <div className="container max-w-3xl mx-auto px-4 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-3xl sm:text-5xl font-display font-extrabold text-foreground mb-4 leading-tight">
            Ready to start earning?
          </h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
            Join thousands of college students already making money with Goteamcrew. Registration is completely free.
          </p>
          <Link href="/register">
            <Button size="lg" className="text-base px-14 h-16 rounded-full bg-primary hover:bg-primary/90 text-white font-bold shadow-2xl hover:-translate-y-1 transition-all duration-300 text-lg">
              Join as Crew — It's Free! <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="text-muted-foreground text-sm mt-4">No fees. No experience needed. WhatsApp contact after approval.</p>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="bg-slate-950 pt-16 pb-8 text-slate-400">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-12">
            <div>
              <div className="bg-white inline-block rounded-xl px-3 py-2 mb-4">
                <img src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`} alt="Goteamcrew" className="h-9 w-auto object-contain" />
              </div>
              <p className="text-sm leading-relaxed max-w-xs">India's leading event crew network connecting college students with top event opportunities.</p>
            </div>
            <div>
              <h4 className="font-bold text-white text-sm mb-4 uppercase tracking-wider">Contact</h4>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> info@goteamcrew.in</li>
                <li className="flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> India</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white text-sm mb-4 uppercase tracking-wider">Quick Links</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/register" className="hover:text-primary transition-colors">Register as Crew</Link></li>
                <li><Link href="/login" className="hover:text-primary transition-colors">Crew Login</Link></li>
                <li><a href="#earn" className="hover:text-primary transition-colors">Why Join Us</a></li>
                <li><a href="#how" className="hover:text-primary transition-colors">How It Works</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs">
            <p>© {new Date().getFullYear()} Goteamcrew. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
