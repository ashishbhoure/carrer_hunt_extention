import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Logo, cx, SkeletonRows } from "../ui/kit";
import { applyTheme, useSettings } from "../ui/hooks";
import { Dashboard } from "./pages/Dashboard";
import { Onboarding } from "./pages/Onboarding";
import { Resumes } from "./pages/Resumes";
import { ProfilePage } from "./pages/Profile";
import { Jobs } from "./pages/Jobs";
import { JobDetail } from "./pages/JobDetail";
import { Documents } from "./pages/Documents";
import { Tracker } from "./pages/Tracker";
import { AnalyticsPage } from "./pages/Analytics";
import { Coach } from "./pages/Coach";
import { SettingsPage } from "./pages/Settings";

const NAV = [
  ["/", "Dashboard"], ["/jobs", "Jobs"], ["/tracker", "Tracker"], ["/resumes", "Resume library"], ["/profile", "Master profile"],
  ["/analytics", "Analytics"], ["/coach", "Career coach"], ["/settings", "Settings"],
] as const;

export function App() {
  const { settings, loading } = useSettings();
  const loc = useLocation();
  useEffect(() => { applyTheme(settings?.theme); }, [settings?.theme]);
  if (loading || !settings) return <div className="mx-auto max-w-3xl p-8"><SkeletonRows n={4} /></div>;
  const fromOnboarding = (loc.state as { fromOnboarding?: boolean } | null)?.fromOnboarding;
  if (!settings.onboardingComplete && !fromOnboarding && loc.pathname === "/") return <Navigate to="/onboarding" replace />;
  if (loc.pathname === "/onboarding") return <Onboarding />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="px-5 py-4"><Logo /></div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cx("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium", isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-2 hover:text-ink")}>{label}</NavLink>
          ))}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-10">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/resumes" element={<Resumes />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/jobs/:id/documents" element={<Documents />} />
          <Route path="/tracker" element={<Tracker />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
