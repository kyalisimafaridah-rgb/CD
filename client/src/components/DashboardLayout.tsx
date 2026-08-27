import { OnboardingWizard } from "@/components/OnboardingWizard";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { SUBSCRIPTION_SUSPENDED_ERR_MSG, TRIAL_EXPIRED_ERR_MSG } from "@shared/const";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, PanelLeft, Users, Stethoscope, Receipt, Pill, BarChart3, Calendar, Settings, ShieldAlert, UserCog, Building2, Lock, MoreHorizontal, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/tiers";

// menuItems defined inside component to support role-based items.
// Labels use plain language so receptionists and clinicians can navigate
// without learning software jargon.
const baseMenuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", title: "Today’s overview and quick actions" },
  { icon: Users, label: "Patients", path: "/patients", title: "Register and manage patients" },
  { icon: Stethoscope, label: "Visits", path: "/visits", title: "Record consultations and prescriptions" },
  { icon: Receipt, label: "Billing", path: "/billing", title: "Bills, payments and outstanding balances" },
  { icon: Pill, label: "Medicines", path: "/inventory", title: "Medicine stock, expiry and low-stock alerts" },
  { icon: Calendar, label: "Appointments", path: "/appointments", title: "Schedule and manage appointments" },
];

// Revenue Reports exposes full clinic financials (getRevenueReport is
// manager/admin-only server-side) — keep it out of the nav for other roles
// rather than showing a link that just errors out.
const reportsItem = { icon: BarChart3, label: "Reports", path: "/reports", title: "Revenue and performance reports" };

// Bottom tab bar shows the 4 highest-frequency actions on mobile; everything
// else (Medicines, Appointments, Reports, Staff, Settings, Owner
// Dashboard) lives behind "More", which opens the existing sidebar sheet
// rather than duplicating that navigation into a second menu.
const bottomTabItems = [
  { icon: LayoutDashboard, label: "Home", path: "/dashboard", title: "Dashboard" },
  { icon: Users, label: "Patients", path: "/patients", title: "Patients" },
  { icon: Stethoscope, label: "Visits", path: "/visits", title: "Visits" },
  { icon: Receipt, label: "Billing", path: "/billing", title: "Billing" },
];

const settingsItem = { icon: Settings, label: "Settings", path: "/settings", title: "Clinic and account settings" };

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (!saved) return DEFAULT_WIDTH;
      const parsed = parseInt(saved, 10);
      // Reject NaN or out-of-range values so corrupted storage can't break the layout
      return !isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH ? parsed : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function BranchSwitcherItems() {
  const { data: branches } = trpc.clinic.getMyBranches.useQuery(undefined, {
    staleTime: 60 * 60 * 1000, // 1 hour — branches change rarely
  });
  const utils = trpc.useUtils();
  const switchMutation = trpc.clinic.switchBranch.useMutation({
    onSuccess: (data) => {
      utils.auth.me.invalidate();
      utils.clinic.get.invalidate();
      window.location.reload(); // reload to pick up new clinicId in all queries
    },
  });

  const { user } = useAuth();
  // Only show branches the user isn't currently on
  const otherBranches = (branches ?? []).filter((b) => b.id !== user?.clinicId);
  if (otherBranches.length === 0) return null;

  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Switch Branch</div>
      {otherBranches.map((b) => (
        <DropdownMenuItem
          key={b.id}
          className="cursor-pointer"
          onClick={() => switchMutation.mutate({ clinicId: b.id })}
        >
          <Building2 className="mr-2 h-4 w-4" />
          <span className="truncate">{b.name}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === "admin";
  const canManage = user?.role === "manager" || user?.role === "admin";

  // Admin accounts run the platform, not a clinic — Owner Dashboard is the
  // only place they belong among these routes. Nav visibility alone (below)
  // doesn't stop someone from landing on a clinic route directly via a
  // bookmark, browser back button, or a stale PWA home-screen shortcut, so
  // this redirect is the actual enforcement; the nav hiding is just the
  // normal-path UX on top of it.
  useEffect(() => {
    if (isAdmin && location !== "/owner") {
      setLocation("/owner");
    }
  }, [isAdmin, location, setLocation]);

  const reportsMenuItem = canManage && !isAdmin ? [reportsItem] : [];
  const staffItem = canManage && !isAdmin
    ? [{ icon: UserCog, label: "Staff", path: "/staff", title: "Invite and manage clinic staff" }]
    : [];
  const adminItem = isAdmin ? [{ icon: ShieldAlert, label: "Owner Dashboard", path: "/owner", title: "Platform-wide clinic overview" }] : [];
  // Admins manage the platform, not a clinic — they don't need Patients,
  // Visits, Billing, Drug Inventory, Appointments, or clinic Settings
  // cluttering their nav. Everyone else keeps the normal clinic menu.
  const menuItems = isAdmin
    ? adminItem
    : [...baseMenuItems, ...reportsMenuItem, ...staffItem, settingsItem, ...adminItem];
  const activeMenuItem = menuItems.find(item => item.path === location);

  const utils = trpc.useUtils();
  const exitImpersonationMutation = trpc.admin.exitImpersonation.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); setLocation("/owner"); },
  });
  const isImpersonating = Boolean((user as any)?.impersonatedBy);

  const clinicQuery = trpc.clinic.get.useQuery();
  const accessErrorMessage = clinicQuery.error?.message;
  const isSuspended = accessErrorMessage === SUBSCRIPTION_SUSPENDED_ERR_MSG;
  const isTrialExpired = accessErrorMessage === TRIAL_EXPIRED_ERR_MSG;
  const isBlocked = (isSuspended || isTrialExpired) && user?.role !== "admin";
  const accessWarning = clinicQuery.data?.accessWarning;
  const isMobile = useIsMobile();

  // Tier status — drives nav lock icons, usage banner, proactive warnings
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery(undefined, {
    staleTime: 60 * 1000,
  });
  const tier = (tierStatus?.tier ?? "free") as SubscriptionTier;
  const limits = tierStatus?.limits ?? TIER_LIMITS["free"];
  const usage = tierStatus?.usage;

  // Nav items that are locked on this tier
  const lockedPaths = new Set<string>();
  if (!limits.reports) lockedPaths.add("/reports");
  if (!limits.drugInventory) lockedPaths.add("/inventory");

  // Proactive usage warning (>= 80% used) — two independent monthly caps on
  // Free: new patient registrations, and visits logged (any patient). Whichever
  // is closer to its limit drives a single combined banner, rather than
  // stacking two separate warning boxes.
  const patientPct = limits.maxPatientsPerMonth && usage
    ? Math.round((usage.patientsThisMonth / limits.maxPatientsPerMonth) * 100)
    : null;
  const visitPct = limits.maxVisitsPerMonth && usage
    ? Math.round((usage.visitsThisMonth / limits.maxVisitsPerMonth) * 100)
    : null;
  const warningMetric: "visits" | "patients" = (visitPct ?? -1) > (patientPct ?? -1) ? "visits" : "patients";
  const activePct = warningMetric === "visits" ? visitPct : patientPct;
  const showPatientWarning = activePct !== null && activePct >= 80;
  const atPatientLimit = activePct !== null && activePct >= 100;

  // Days until monthly counters reset (both patients and visits reset together,
  // on the same calendar-month boundary)
  const now = new Date();
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysUntilReset = Math.ceil((firstOfNextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  if (isBlocked) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isSuspended ? "Account suspended" : "Upgrade to continue"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isSuspended
                ? "This clinic's account has been suspended. Your data is safe and will be restored as soon as your account is reactivated. Contact us to resolve this."
                : "Your free plan no longer covers your usage. Upgrade to Clinic (UGX 90,000/mo) to continue accessing CareDesk. Your data is safe."}
            </p>
          </div>
          <Button onClick={logout} variant="outline" size="lg" className="w-full">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <img src="/logo.png" alt="" className="w-5 h-5 rounded shrink-0 object-cover" />
                  <span className="font-semibold tracking-tight truncate">
                    CareDesk
                  </span>
                </div>
              ) : (
                <img src="/logo.png" alt="CareDesk" className="w-6 h-6 rounded object-cover mx-auto" />
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                const isLocked = lockedPaths.has(item.path);
                const tip = isLocked
                  ? `${item.label} — Clinic plan required`
                  : (item as { title?: string }).title || item.label;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={tip}
                      aria-label={tip}
                      className={`h-10 transition-all font-normal ${isLocked ? "opacity-50" : ""}`}
                    >
                      <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} aria-hidden="true" />
                      <span>{item.label}</span>
                      {isLocked && !isCollapsed && (
                        <Lock className="h-3 w-3 ml-auto text-gray-400 shrink-0" aria-hidden="true" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <BranchSwitcherItems />
                <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">
                  {theme === "dark" ? (
                    <Sun className="mr-2 h-4 w-4" />
                  ) : (
                    <Moon className="mr-2 h-4 w-4" />
                  )}
                  <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        <OnboardingWizard />
        {accessWarning && (
          <Alert className={`mx-4 mt-4 ${
            accessWarning === "subscription_expired" || accessWarning === "grace_period"
              ? "border-red-300 bg-red-50"
              : accessWarning === "subscription_ending"
                ? "border-amber-300 bg-amber-50"
                : ""
          }`}>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>
              {accessWarning === "grace_period"
                ? "Payment issue with your subscription"
                : accessWarning === "subscription_ending"
                  ? "Your paid plan ends soon"
                  : accessWarning === "subscription_expired"
                    ? "Paid plan ended — you are on Free"
                    : accessWarning === "trial_ending"
                      ? "Your trial is ending soon"
                      : "Upgrade to keep your clinic running smoothly"}
            </AlertTitle>
            <AlertDescription>
              {accessWarning === "grace_period"
                ? "Please contact support to restore full access. Your data is safe."
                : accessWarning === "subscription_ending"
                  ? "Renew via Settings → Subscription (MTN MoMo) before the end date to keep Clinic/Pro features."
                  : accessWarning === "subscription_expired"
                    ? "Your prepaid period finished. Free limits apply again. Pay via MTN MoMo under Settings to upgrade."
                    : accessWarning === "trial_ending"
                      ? "Upgrade under Settings before your trial ends to avoid interruptions."
                      : "You're on the Free plan. Upgrade to Clinic (UGX 90,000/mo) for more capacity and features."}
            </AlertDescription>
          </Alert>
        )}

        {/* Proactive usage warning — shown at 80%+ on free tier, for whichever
            of patients/visits is closer to its cap */}
        {showPatientWarning && !accessWarning && (
          <Alert
            className={`mx-4 mt-4 ${atPatientLimit ? "border-red-400 bg-red-50" : "border-yellow-400 bg-yellow-50"}`}
          >
            <ShieldAlert className={`h-4 w-4 ${atPatientLimit ? "text-red-600" : "text-yellow-600"}`} />
            <AlertTitle className={atPatientLimit ? "text-red-800" : "text-yellow-800"}>
              {atPatientLimit
                ? `${warningMetric === "visits" ? "Visit" : "Patient"} limit reached`
                : `${activePct}% of monthly ${warningMetric === "visits" ? "visit" : "patient"} limit used`}
            </AlertTitle>
            <AlertDescription className={atPatientLimit ? "text-red-700" : "text-yellow-700"}>
              {warningMetric === "visits" ? (
                atPatientLimit
                  ? `You've used all ${limits.maxVisitsPerMonth} visits for this month. The counter resets in ${daysUntilReset} day${daysUntilReset === 1 ? "" : "s"}, or upgrade to Clinic (UGX 90,000/mo) for unlimited visits.`
                  : `You have ${(limits.maxVisitsPerMonth ?? 0) - (usage?.visitsThisMonth ?? 0)} visits left this month (resets in ${daysUntilReset} day${daysUntilReset === 1 ? "" : "s"}). Upgrade to Clinic (UGX 90,000/mo) for unlimited visits.`
              ) : (
                atPatientLimit
                  ? `You've used all ${limits.maxPatientsPerMonth} patient registrations for this month. The counter resets in ${daysUntilReset} day${daysUntilReset === 1 ? "" : "s"}, or upgrade to Clinic (UGX 90,000/mo) for unlimited patients.`
                  : `You have ${(limits.maxPatientsPerMonth ?? 0) - (usage?.patientsThisMonth ?? 0)} registrations left this month (resets in ${daysUntilReset} day${daysUntilReset === 1 ? "" : "s"}). Upgrade to Clinic (UGX 90,000/mo) for unlimited patients.`
              )}
              {" "}
              <button
                className="underline font-medium"
                onClick={() => setLocation("/settings")}
              >
                View plans
              </button>
            </AlertDescription>
          </Alert>
        )}

        {isMobile && (
          <div className="flex border-b h-14 items-center gap-2 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40 pt-safe">
            <img src="/logo.png" alt="" className="w-5 h-5 rounded shrink-0 object-cover" />
            <span className="font-semibold tracking-tight text-foreground truncate flex-1">
              {activeMenuItem?.label ?? "CareDesk"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <ShieldAlert className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setLocation("/owner")} className="cursor-pointer">
                    <ShieldAlert className="mr-2 h-4 w-4" /> Owner Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {isImpersonating && (
          <div className="bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between">
            <span>⚠️ You are viewing this clinic as an impersonated user.</span>
            <button
              className="underline font-medium ml-4 hover:text-amber-100"
              onClick={() => exitImpersonationMutation.mutate()}
              disabled={exitImpersonationMutation.isPending}
            >
              {exitImpersonationMutation.isPending ? "Exiting…" : "Exit impersonation"}
            </button>
          </div>
        )}
        <main className={`flex-1 p-4 ${isMobile && !isAdmin ? "pb-24" : ""}`}>
          <div key={location} className="route-enter">{children}</div>
        </main>
      </SidebarInset>

      {isMobile && !isAdmin && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur pb-safe">
          {bottomTabItems.map((item) => {
            const isActive = location === item.path;
            const tip = (item as { title?: string }).title || item.label;
            return (
              <button
                key={item.path}
                onClick={() => setLocation(item.path)}
                aria-label={tip}
                title={tip}
                className={`tap-feedback flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                <span className={`text-[11px] leading-none truncate ${isActive ? "font-medium" : ""}`}>{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={toggleSidebar}
            aria-label="More menu"
            title="More"
            className="tap-feedback flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            <span className="text-[11px] leading-none">More</span>
          </button>
        </nav>
      )}
    </>
  );
}
