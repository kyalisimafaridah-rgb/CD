import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users, TrendingUp, AlertCircle, Activity, Calendar, Stethoscope,
  Receipt, Clock, ArrowRight, Flag,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const ROLE_REDIRECT: Record<string, string | null> = {
  receptionist: null,
  doctor: null,
  manager: null,
  admin: null,
};

function QuickAction({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  // Use wouter navigate — <a href> causes a full page reload in an SPA.
  const [, navigate] = useLocation();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center gap-3 p-4 border rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors group w-full text-left"
    >
      <Icon className="w-5 h-5 text-green-600" />
      <span className="font-medium text-gray-900 text-sm">{label}</span>
      <ArrowRight className="w-4 h-4 text-gray-400 ml-auto group-hover:text-green-600" />
    </button>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isDoctor = user?.role === "doctor";
  const isReceptionist = user?.role === "receptionist";
  const canManage = user?.role === "manager" || user?.role === "admin";

  const { data: stats, isLoading: statsLoading, dataUpdatedAt } = trpc.dashboard.getTodayStats.useQuery(undefined, {
    refetchInterval: 3 * 60 * 1000,
  });
  const { data: todayApts } = trpc.appointment.today.useQuery();
  const { data: followUps } = trpc.dashboard.getFollowUps.useQuery();
  const { data: debtors } = trpc.patient.getDebtors.useQuery(undefined, { enabled: canManage });
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" }) : null;

  const pendingApts = (todayApts ?? []).filter((a) => a.status === "scheduled" || a.status === "confirmed");
  const urgentDebtors = (debtors ?? []).filter((d: any) => d.totalOwed > 100000).slice(0, 3);

  // Tier usage widget data
  const patientLimit = tierStatus?.limits?.maxPatientsPerMonth ?? null;
  const patientsThisMonth = tierStatus?.usage?.patientsThisMonth ?? 0;
  const patientPct = patientLimit ? Math.min(100, Math.round((patientsThisMonth / patientLimit) * 100)) : null;
  const visitLimit = tierStatus?.limits?.maxVisitsPerMonth ?? null;
  const visitsThisMonth = tierStatus?.usage?.visitsThisMonth ?? 0;
  const visitPct = visitLimit ? Math.min(100, Math.round((visitsThisMonth / visitLimit) * 100)) : null;
  const staffLimit = tierStatus?.limits?.maxStaff ?? null;
  const activeStaff = tierStatus?.usage?.activeStaff ?? 0;
  const tier = tierStatus?.tier ?? "free";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {isDoctor ? "My Dashboard" : isReceptionist ? "Front Desk" : "Dashboard"}
            </h1>
            <p className="text-gray-600 mt-1">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user?.name?.split(" ")[0]}
            </p>
          </div>
          {lastUpdated && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Updated {lastUpdated}
            </div>
          )}
        </div>

        {/* Morning briefing — role aware */}
        {!isDoctor && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Today's queue */}
            <button onClick={() => navigate("/appointments")} className="block w-full text-left">
              <Card className="hover:border-green-300 transition-colors cursor-pointer h-full">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-gray-600 font-medium">Today's Appointments</p>
                    <Calendar className="w-5 h-5 text-green-600 opacity-60" />
                  </div>
                  <p className="text-3xl font-bold">{pendingApts.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">pending</p>
                  {pendingApts.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {pendingApts.slice(0, 3).map((a) => (
                        <div key={a.id} className="text-xs text-gray-500 flex gap-2">
                          <span className="text-green-700 font-medium">
                            {new Date(a.appointmentDate).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="truncate">{a.reason || "Visit"}</span>
                        </div>
                      ))}
                      {pendingApts.length > 3 && <p className="text-xs text-gray-400">+{pendingApts.length - 3} more</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>

            {/* Stats */}
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-600 font-medium mb-3">Today's Numbers</p>
                {statsLoading ? (
                  <div className="text-gray-400 text-sm">Loading...</div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Patients seen</span>
                      <span className="font-bold">{stats?.patientCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Revenue</span>
                      <span className="font-bold text-green-700">UGX {(stats?.revenueCollected ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Unpaid bills</span>
                      <button onClick={() => navigate("/billing")} className="font-bold text-red-600 hover:underline">
                        {stats?.unpaidBillsCount ?? 0}
                      </button>
                    </div>
                    {canManage && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Outstanding</span>
                        <button onClick={() => navigate("/billing")} className="font-bold text-red-600 hover:underline">
                          UGX {(stats?.unpaidBillsAmount ?? 0).toLocaleString()}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Urgent alerts */}
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-600 font-medium mb-3">Alerts</p>
                <div className="space-y-2">
                  {followUps && followUps.length > 0 && (
                    <button onClick={() => navigate("/visits")} className="flex items-center gap-2 text-sm text-orange-700 hover:underline">
                      <Flag className="w-4 h-4 flex-shrink-0" />
                      {followUps.length} follow-up{followUps.length !== 1 ? "s" : ""} due
                    </button>
                  )}
                  {canManage && urgentDebtors.length > 0 && (
                    <button onClick={() => navigate("/billing")} className="flex items-center gap-2 text-sm text-red-700 hover:underline">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {urgentDebtors.length} high-value debt{urgentDebtors.length !== 1 ? "s" : ""}
                    </button>
                  )}
                  {pendingApts.length > 5 && (
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                      <Calendar className="w-4 h-4 flex-shrink-0" />
                      Busy day — {pendingApts.length} appointments
                    </div>
                  )}
                  {!followUps?.length && !urgentDebtors.length && pendingApts.length <= 5 && (
                    <p className="text-sm text-green-600">✓ All clear</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Doctor view — today's appointments only */}
        {isDoctor && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-green-600" />
                My Appointments Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingApts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No appointments assigned to you today</p>
              ) : (
                <div className="space-y-2">
                  {pendingApts.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded border">
                      <span className="text-green-700 font-bold text-sm w-16 flex-shrink-0">
                        {new Date(a.appointmentDate).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.reason || "Visit"}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4">
                <button onClick={() => navigate("/appointments")} className="text-sm text-green-600 hover:underline">View full schedule →</button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick actions */}
        <Card>
          <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {!isDoctor && <QuickAction href="/patients" icon={Users} label="Register Patient" />}
              <QuickAction href="/appointments" icon={Calendar} label="Book Appointment" />
              <QuickAction href="/visits" icon={Stethoscope} label="New Visit" />
              {!isDoctor && <QuickAction href="/billing" icon={Receipt} label="Record Payment" />}
              {canManage && <QuickAction href="/reports" icon={TrendingUp} label="Revenue Reports" />}
              {canManage && <QuickAction href="/staff" icon={Activity} label="Manage Staff" />}
            </div>
          </CardContent>
        </Card>

        {/* Tier usage card — only shown when on free tier with limits */}
        {tier === "free" && patientLimit !== null && canManage && (
          <Card className={patientPct !== null && patientPct >= 80 ? "border-yellow-400" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Free Plan Usage</span>
                <button
                  className="text-sm font-normal text-blue-600 hover:underline"
                  onClick={() => navigate("/settings")}
                >
                  Upgrade →
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {patientLimit !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Patients this month</span>
                    <span className={`font-medium ${patientPct !== null && patientPct >= 90 ? "text-red-600" : "text-gray-700"}`}>
                      {patientsThisMonth} / {patientLimit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${patientPct !== null && patientPct >= 90 ? "bg-red-500" : patientPct !== null && patientPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${patientPct ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
              {visitLimit !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Visits this month</span>
                    <span className={`font-medium ${visitPct !== null && visitPct >= 90 ? "text-red-600" : "text-gray-700"}`}>
                      {visitsThisMonth} / {visitLimit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${visitPct !== null && visitPct >= 90 ? "bg-red-500" : visitPct !== null && visitPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${visitPct ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
              {staffLimit !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Staff members</span>
                    <span className="font-medium text-gray-700">{activeStaff} / {staffLimit}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full bg-blue-500"
                      style={{ width: `${Math.min(100, Math.round((activeStaff / staffLimit) * 100))}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400">
                Upgrade to Clinic (UGX 90,000/mo) for unlimited patients, 5 staff, drug inventory, reports.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Follow-ups */}
        {followUps && followUps.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-700">
                <Flag className="w-5 h-5" />
                Follow-ups Due ({followUps.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {followUps.slice(0, 5).map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between p-3 rounded border border-orange-100 bg-orange-50 text-sm">
                    <div>
                      <p className="font-medium">Patient #{v.patientId}</p>
                      {v.followUpDate && (
                        <p className="text-xs text-orange-600">
                          Due: {new Date(v.followUpDate).toLocaleDateString("en-UG", { day: "numeric", month: "short" })}
                        </p>
                      )}
                    </div>
                    <button onClick={() => navigate("/visits")} className="text-xs text-orange-700 underline">View Visit</button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
