import { useState, useMemo } from "react";
import { exportCsv } from "@/lib/csv";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, Loader2, Download, TrendingUp, Lock, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";

function ReportsLockedScreen() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="bg-blue-50 rounded-full p-5 mb-6">
        <Lock className="h-10 w-10 text-blue-500" />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">Revenue Reports</h2>
      <p className="text-muted-foreground mb-1 max-w-sm">
        Revenue reports, daily reconciliation, and collection rate analysis are available on the Clinic plan.
      </p>
      <p className="text-gray-400 text-sm mb-8 max-w-sm">
        Upgrade to see exactly how much your clinic is collecting, where revenue is coming from, and what's outstanding.
      </p>
      <div className="flex gap-3">
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => navigate("/settings?upgrade=clinic")}
        >
          <Zap className="h-4 w-4 mr-2" />
          Upgrade to Clinic — UGX 90,000/mo
        </Button>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          View plans
        </Button>
      </div>
    </div>
  );
}

type QuickRange = "today" | "week" | "month" | "custom";

function getRange(range: QuickRange): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  if (range === "today") return { start: end, end };
  if (range === "week") {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    return { start: d.toISOString().split("T")[0], end };
  }
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: d.toISOString().split("T")[0], end };
}

export default function RevenueReports() {
  const { user } = useAuth();
  const canManage = user?.role === "manager" || user?.role === "admin";
  const [quickRange, setQuickRange] = useState<QuickRange>("month");
  const [startDate, setStartDate] = useState(getRange("month").start);
  const [endDate, setEndDate] = useState(getRange("month").end);

  // Check tier before making report queries — show upgrade screen for free tier
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const reportsEnabled = tierStatus?.limits?.reports ?? true; // optimistic while loading

  const { data: report, isLoading } = trpc.dashboard.getRevenueReport.useQuery(
    { startDate, endDate },
    { enabled: reportsEnabled }
  );
  const { data: doctorPerf, isLoading: doctorLoading } = trpc.dashboard.getDoctorPerformance.useQuery(
    { startDate, endDate },
    { enabled: canManage && reportsEnabled }
  );

  function applyQuick(r: QuickRange) {
    setQuickRange(r);
    if (r !== "custom") {
      const { start, end } = getRange(r);
      setStartDate(start); setEndDate(end);
    }
  }

  // Build a daily chart from bills data
  const dailyChart = useMemo(() => {
    if (!report?.bills) return [];
    const map = new Map<string, number>();
    for (const b of report.bills) {
      if (b.paymentStatus === "paid" || b.paymentStatus === "partial") {
        const day = new Date(b.billDate).toLocaleDateString("en-UG", { day: "numeric", month: "short" });
        map.set(day, (map.get(day) ?? 0) + parseFloat(b.amountPaid?.toString() || "0"));
      }
    }
    return [...map.entries()].map(([date, revenue]) => ({ date, revenue }));
  }, [report]);

  const breakdownData = report ? [
    { name: "Consultation", value: report.consultationRevenue || 0, color: "#16a34a" },
    { name: "Lab Tests", value: report.labRevenue || 0, color: "#2563eb" },
    { name: "Drugs", value: report.drugRevenue || 0, color: "#7c3aed" },
  ] : [];

  function handleExport() {
    if (!report?.bills) return;
    exportCsv(`revenue-${startDate}-to-${endDate}.csv`,
      ["Bill No.", "Date", "Total", "Paid", "Status"],
      report.bills.map((b) => [
        b.billNumber, new Date(b.billDate).toLocaleDateString(),
        Number(b.grandTotal), Number(b.amountPaid), b.paymentStatus
      ])
    );
  }

  // Show upgrade screen for free tier users instead of blank/loading
  if (tierStatus && !reportsEnabled) {
    return (
      <DashboardLayout>
        <ReportsLockedScreen />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Revenue Reports</h1>
            <p className="text-muted-foreground mt-1">Financial performance and analytics</p>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={!report}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
        </div>

        {/* Date range */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3 sm:items-center">
              {(["today", "week", "month", "custom"] as QuickRange[]).map((r) => (
                <Button key={r} size="sm" variant={quickRange === r ? "default" : "outline"}
                  className={quickRange === r ? "bg-green-600 hover:bg-green-700" : ""}
                  onClick={() => applyQuick(r)}>
                  {r === "today" ? "Today" : r === "week" ? "Last 7 Days" : r === "month" ? "This Month" : "Custom"}
                </Button>
              ))}
              {quickRange === "custom" && (
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-center">
                  <div className="flex items-center gap-1"><Label className="text-xs">From</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-36 text-sm" /></div>
                  <div className="flex items-center gap-1"><Label className="text-xs">To</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-36 text-sm" /></div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
        ) : !report ? (
          <div className="text-center py-12"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-muted-foreground">No data for this period</p></div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-green-500"><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-xl font-bold text-green-700">UGX {report.totalRevenue.toLocaleString()}</p></CardContent></Card>
              <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Bills Raised</p><p className="text-xl font-bold text-blue-700">{report.totalBills}</p></CardContent></Card>
              <Card className="border-l-4 border-l-red-500"><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-bold text-red-700">UGX {report.unpaidAmount.toLocaleString()}</p></CardContent></Card>
              <Card className="border-l-4 border-l-purple-500"><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Collection Rate</p><p className="text-xl font-bold text-purple-700">{report.collectionRate}%</p></CardContent></Card>
            </div>

            {/* Daily revenue bar chart */}
            {dailyChart.length > 1 && (
              <Card>
                <CardHeader><CardTitle>Daily Revenue</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={dailyChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: any) => [`UGX ${Number(v).toLocaleString()}`, "Revenue"]} />
                      <Bar dataKey="revenue" fill="#16a34a" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Revenue breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Service Type</CardTitle>
                <CardDescription>Breakdown of what's generating revenue</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {breakdownData.map((d) => {
                    const pct = report.totalRevenue > 0 ? Math.round((d.value / report.totalRevenue) * 100) : 0;
                    return (
                      <div key={d.name}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{d.name}</span>
                          <span>UGX {d.value.toLocaleString()} <span className="text-muted-foreground text-xs">({pct}%)</span></span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Doctor performance — manager only */}
            {canManage && (
              <Card>
                <CardHeader>
                  <CardTitle>Doctor Performance</CardTitle>
                  <CardDescription>Visits and consultation revenue per doctor</CardDescription>
                </CardHeader>
                <CardContent>
                  {doctorLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : !doctorPerf || doctorPerf.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No doctor data for this period</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted border-b">
                          <tr>
                            <th className="text-left py-2 px-4">Doctor</th>
                            <th className="text-center py-2 px-4">Visits</th>
                            <th className="text-right py-2 px-4">Consultation Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {doctorPerf.map((d: any) => (
                            <tr key={d.doctorId} className="hover:bg-muted">
                              <td className="py-2 px-4 font-medium">{d.doctorName}</td>
                              <td className="py-2 px-4 text-center">{d.visitCount}</td>
                              <td className="py-2 px-4 text-right text-green-700">UGX {d.revenue.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Bills table */}
            <Card>
              <CardHeader><CardTitle>Bills in Period ({report.totalBills})</CardTitle></CardHeader>
              <CardContent>
                {report.bills.length === 0 ? (
                  <div className="text-center py-8"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-muted-foreground">No bills in this period</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted border-b">
                        <tr>
                          <th className="text-left py-2 px-4">Bill No.</th>
                          <th className="text-left py-2 px-4">Date</th>
                          <th className="text-right py-2 px-4">Total</th>
                          <th className="text-right py-2 px-4">Paid</th>
                          <th className="text-left py-2 px-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {report.bills.map((bill: any) => (
                          <tr key={bill.id} className="hover:bg-muted">
                            <td className="py-2 px-4 font-medium">{bill.billNumber}</td>
                            <td className="py-2 px-4">{new Date(bill.billDate).toLocaleDateString()}</td>
                            <td className="py-2 px-4 text-right">UGX {Number(bill.grandTotal).toLocaleString()}</td>
                            <td className="py-2 px-4 text-right text-green-700">UGX {Number(bill.amountPaid).toLocaleString()}</td>
                            <td className="py-2 px-4">
                              <span className={`text-xs px-2 py-1 rounded-full ${bill.paymentStatus === "paid" ? "bg-green-100 text-green-700" : bill.paymentStatus === "partial" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                                {bill.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
