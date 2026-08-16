import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Calendar, Loader2, UserPlus, RefreshCw } from "lucide-react";
import { PatientCombobox } from "@/components/PatientCombobox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { parseTierError } from "@shared/tiers";
import { EmptyState } from "@/components/EmptyState";

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  confirmed: "bg-green-100 text-green-700",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-700",
  no_show:   "bg-orange-100 text-orange-700",
};

function fmt(date: string | Date) {
  return new Date(date).toLocaleString("en-UG", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtTime(date: string | Date) {
  return new Date(date).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" });
}

// ─── Book appointment dialog ──────────────────────────────────────────────────

function BookDialog({ onBooked }: { onBooked: () => void }) {
  const today = new Date().toISOString().slice(0, 16);
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [dateTime, setDateTime] = useState(today);
  const [duration, setDuration] = useState("30");
  const [reason, setReason] = useState("");
  const [doctorId, setDoctorId] = useState("");

  const { data: patients } = trpc.patient.list.useQuery();
  const { data: staffList } = trpc.staff.list.useQuery();
  const doctors = useMemo(
    () => staffList?.filter((s) => s.role === "doctor" || s.role === "manager") ?? [],
    [staffList]
  );

  const bookMutation = useOfflineMutation({
    procedure: "appointment.create",
    label: (input) => {
      const p = patients?.find((pt) => pt.id === input.patientId);
      const name = p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : "Patient";
      return `Book: ${name} — ${fmt(input.appointmentDate as string)}`;
    },
  });

  const resetForm = () => {
    setPatientId(""); setDateTime(today); setDuration("30"); setReason(""); setDoctorId("");
  };

  const submitBooking = async (forceCreate = false) => {
    const input = {
      patientId: parseInt(patientId),
      appointmentDate: dateTime,
      duration: parseInt(duration) || 30,
      reason: reason || undefined,
      assignedDoctor: doctorId ? parseInt(doctorId) : undefined,
      forceCreate,
    };
    try {
      const result = await bookMutation.mutate(input);
      if (result.queued) {
        toast.success("Saved offline — will book and notify the patient once you're back online.");
      } else {
        toast.success("Appointment booked — SMS sent to patient");
      }
      setOpen(false);
      resetForm();
      onBooked();
    } catch (e: any) {
      // Double-booking is a live check that only means something while
      // online (queued items are re-checked server-side at sync time
      // instead, and land in Sync Issues if the slot's since been taken).
      if (e?.data?.code === "CONFLICT" && bookMutation.isOnline) {
        const ok = window.confirm(`${e.message}\n\nBook anyway?`);
        if (ok) await submitBooking(true);
        return;
      }
      if (!parseTierError(e?.message ?? "")) {
        toast.error(e?.message ?? "Couldn't book the appointment");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" />Book Appointment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Book Appointment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Patient *</Label>
            <PatientCombobox patients={patients} value={patientId} onChange={setPatientId} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date & Time *</Label>
              <Input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Duration (min)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min={5} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Assign Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue placeholder="Any available" /></SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for visit" />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-green-600 hover:bg-green-700 w-full"
            disabled={bookMutation.isPending || !patientId || !dateTime}
            onClick={() => submitBooking(false)}
          >
            {bookMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Book & Notify Patient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Walk-in dialog ───────────────────────────────────────────────────────────

function WalkInDialog({ onBooked }: { onBooked: () => void }) {
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [reason, setReason] = useState("");

  const { data: patients } = trpc.patient.list.useQuery();

  const mutation = trpc.appointment.walkIn.useMutation({
    onSuccess: () => {
      toast.success("Walk-in registered");
      setOpen(false); setPatientId(""); setReason("");
      onBooked();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="w-4 h-4 mr-2" />Walk-in
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Register Walk-in</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Patient *</Label>
            <PatientCombobox patients={patients} value={patientId} onChange={setPatientId} />
          </div>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever, check-up" />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-green-600 hover:bg-green-700 w-full"
            disabled={mutation.isPending || !patientId}
            onClick={() => mutation.mutate({ patientId: parseInt(patientId), reason: reason || undefined })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add to Queue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reschedule dialog ────────────────────────────────────────────────────────

function RescheduleDialog({ appointmentId, onRescheduled }: { appointmentId: number; onRescheduled: () => void }) {
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 16));

  const mutation = trpc.appointment.reschedule.useMutation({
    onSuccess: () => {
      toast.success("Appointment rescheduled — new SMS sent to patient");
      setOpen(false);
      onRescheduled();
    },
    onError: (e) => {
      if (e.data?.code === "CONFLICT") {
        const ok = window.confirm(`${e.message}\n\nReschedule anyway?`);
        if (ok) mutation.mutate({ id: appointmentId, newDate, forceReschedule: true });
        return;
      }
      toast.error(e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-xs">
          <RefreshCw className="w-3 h-3 mr-1" />Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reschedule Appointment</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>New Date & Time</Label>
          <Input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button
            className="bg-green-600 hover:bg-green-700"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ id: appointmentId, newDate })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reschedule & Notify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function AppointmentActions({ apt, onRefetch }: { apt: any; onRefetch: () => void }) {
  const update = trpc.appointment.update.useMutation({
    onSuccess: () => { toast.success("Updated"); onRefetch(); },
    onError: (e) => toast.error(e.message),
  });

  const actions: { label: string; status: string; className?: string }[] = [];

  if (apt.status === "scheduled") {
    actions.push({ label: "Confirm", status: "confirmed", className: "text-green-700" });
    actions.push({ label: "No-show", status: "no_show", className: "text-orange-600" });
    actions.push({ label: "Cancel", status: "cancelled", className: "text-red-600" });
  } else if (apt.status === "confirmed") {
    actions.push({ label: "Complete", status: "completed" });
    actions.push({ label: "No-show", status: "no_show", className: "text-orange-600" });
    actions.push({ label: "Cancel", status: "cancelled", className: "text-red-600" });
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {actions.map((a) => (
        <Button
          key={a.status}
          size="sm"
          variant="ghost"
          className={`text-xs ${a.className ?? ""}`}
          disabled={update.isPending}
          onClick={() => update.mutate({ id: apt.id, status: a.status as any })}
        >
          {a.label}
        </Button>
      ))}
      {(apt.status === "scheduled" || apt.status === "confirmed") && (
        <RescheduleDialog appointmentId={apt.id} onRescheduled={onRefetch} />
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Appointments() {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(nextWeek);
  const isDoctor = user?.role === "doctor";

  const todayQuery = trpc.appointment.today.useQuery();
  const { data: patients } = trpc.patient.list.useQuery();
  const { data: allApts, isLoading, refetch } = trpc.appointment.list.useQuery({ fromDate, toDate });

  const todayApts = todayQuery.data ?? [];
  const pending = todayApts.filter((a) => a.status === "scheduled" || a.status === "confirmed");

  function patientName(patientId: number) {
    const p = patients?.find((x) => x.id === patientId);
    return p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : `Patient #${patientId}`;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Appointments</h1>
            <p className="text-muted-foreground mt-1">Schedule and manage patient appointments</p>
          </div>
          <div className="flex gap-2">
            <WalkInDialog onBooked={() => { todayQuery.refetch(); refetch(); }} />
            <BookDialog onBooked={() => { todayQuery.refetch(); refetch(); }} />
          </div>
        </div>

        {/* Today's queue */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-600" />
              Today's Queue
              {pending.length > 0 && (
                <Badge className="bg-green-600 text-white ml-1">{pending.length} pending</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayQuery.isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : todayApts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {isDoctor ? "No appointments assigned to you today" : "No appointments today"}
              </p>
            ) : (
              <div className="space-y-2">
                {todayApts.map((apt) => (
                  <div key={apt.id} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between p-3 rounded-lg border bg-card hover:bg-muted">
                    <div className="flex items-start gap-3">
                      <div className="text-center min-w-[50px]">
                        <p className="text-sm font-bold text-green-700">{fmtTime(apt.appointmentDate)}</p>
                        <p className="text-xs text-gray-400">{apt.duration}min</p>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{patientName(apt.patientId)}</p>
                        {apt.reason && <p className="text-xs text-muted-foreground">{apt.reason}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[apt.status ?? "scheduled"]}`}>
                        {apt.status}
                      </span>
                      <AppointmentActions apt={apt} onRefetch={() => { todayQuery.refetch(); refetch(); }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Date range filter */}
        {!isDoctor && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-center sm:flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="w-8 shrink-0">From</Label>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="flex-1 sm:w-40" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="w-8 shrink-0">To</Label>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="flex-1 sm:w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>All Appointments ({allApts?.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                ) : !allApts || allApts.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    title="No appointments in this period"
                    description="Book an appointment for a patient using the button above. You can also send SMS reminders automatically."
                  />
                ) : (
                  <>
                    {/* ── Mobile appointment cards ─────────── */}
                    <div className="sm:hidden divide-y divide-gray-100">
                      {allApts.map((apt) => (
                        <div key={apt.id} className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm">{patientName(apt.patientId)}</p>
                              <p className="text-xs text-muted-foreground">{fmt(apt.appointmentDate)} · {apt.duration} min</p>
                              {apt.reason && <p className="text-xs text-muted-foreground mt-0.5">{apt.reason}</p>}
                            </div>
                            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[apt.status ?? "scheduled"]}`}>
                              {apt.status}
                            </span>
                          </div>
                          <AppointmentActions apt={apt} onRefetch={() => { todayQuery.refetch(); refetch(); }} />
                        </div>
                      ))}
                    </div>
                    {/* ── Desktop table ────────────────────── */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted border-b">
                          <tr>
                            <th className="text-left py-3 px-4">Patient</th>
                            <th className="text-left py-3 px-4">Date & Time</th>
                            <th className="text-left py-3 px-4">Duration</th>
                            <th className="text-left py-3 px-4">Reason</th>
                            <th className="text-left py-3 px-4">Status</th>
                            <th className="text-left py-3 px-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {allApts.map((apt) => (
                            <tr key={apt.id} className="hover:bg-muted">
                              <td className="py-3 px-4 font-medium">{patientName(apt.patientId)}</td>
                              <td className="py-3 px-4">{fmt(apt.appointmentDate)}</td>
                              <td className="py-3 px-4">{apt.duration} min</td>
                              <td className="py-3 px-4 text-muted-foreground">{apt.reason || "—"}</td>
                              <td className="py-3 px-4">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[apt.status ?? "scheduled"]}`}>{apt.status}</span>
                              </td>
                              <td className="py-3 px-4"><AppointmentActions apt={apt} onRefetch={() => { todayQuery.refetch(); refetch(); }} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
