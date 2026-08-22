import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Building2, UserPlus, Stethoscope, Receipt, CheckCircle2, ArrowRight, ArrowLeft,
  Sparkles, Pill, Calendar, Smartphone, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const STEPS = [
  { id: "welcome", title: "Welcome" },
  { id: "clinic", title: "Clinic" },
  { id: "workflow", title: "Daily work" },
  { id: "team", title: "Team" },
  { id: "plan", title: "Your plan" },
  { id: "done", title: "Ready" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function OnboardingWizard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: clinic, isLoading } = trpc.clinic.get.useQuery(undefined, {
    enabled: Boolean(user?.clinicId),
  });

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex].id as StepId;

  const [form, setForm] = useState({
    phone: "",
    city: "",
    consultationFee: "20000",
  });
  useEffect(() => {
    if (!clinic) return;
    setForm({
      phone: clinic.phone ?? "",
      city: clinic.city ?? "",
      consultationFee: clinic.consultationFee ? String(Number(clinic.consultationFee)) : "20000",
    });
  }, [clinic?.id]);

  const updateMutation = trpc.clinic.update.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const completeMutation = trpc.clinic.completeOnboarding.useMutation({
    onSuccess: async () => {
      await utils.clinic.get.invalidate();
      toast.success("You're all set — welcome to CareDesk");
    },
    onError: (e) => toast.error(e.message),
  });

  const progress = useMemo(
    () => Math.round(((stepIndex + 1) / STEPS.length) * 100),
    [stepIndex]
  );

  const shouldShow =
    !isLoading &&
    user &&
    (user.role === "manager" || user.role === "admin") &&
    Boolean(user.clinicId) &&
    clinic &&
    !(clinic as { onboardingCompletedAt?: string | Date | null }).onboardingCompletedAt;

  if (!shouldShow) return null;

  async function saveClinicAndNext() {
    const fee = Number(form.consultationFee);
    await updateMutation.mutateAsync({
      phone: form.phone.trim() || undefined,
      city: form.city.trim() || undefined,
      consultationFee: Number.isFinite(fee) ? fee : undefined,
    });
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  async function finish(path?: string) {
    await completeMutation.mutateAsync();
    if (path) navigate(path);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
        {/* Progress */}
        <div className="px-6 pt-5 pb-3 border-b bg-gradient-to-r from-green-50 to-white">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-green-800 tracking-wide uppercase">
              Clinic setup · {stepIndex + 1} of {STEPS.length}
            </p>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-800"
              disabled={completeMutation.isPending}
              onClick={() => finish()}
            >
              Skip for now
            </button>
          </div>
          <div className="h-1.5 w-full rounded-full bg-green-100 overflow-hidden">
            <div
              className="h-full bg-green-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="px-6 py-6 min-h-[320px]">
          {step === "welcome" && (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-800 px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                Welcome to CareDesk
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                Let&apos;s set up {clinic.name}
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                In a few short steps you&apos;ll confirm clinic details, see how daily work flows,
                and know how your Free plan works. You can change everything later in Settings.
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                {[
                  "Patients, visits, and billing in one place",
                  "Roles for receptionists, doctors, and managers",
                  "Works well for busy clinics in Uganda and East Africa",
                ].map((t) => (
                  <li key={t} className="flex gap-2 items-start">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === "clinic" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <Building2 className="h-5 w-5" />
                <h2 className="text-xl font-bold text-gray-900">Clinic details</h2>
              </div>
              <p className="text-sm text-gray-600">
                Your clinic name is used as the <strong>MTN MoMo payment reason</strong> when you upgrade.
                Keep it clear and consistent.
              </p>
              <div className="rounded-lg border bg-gray-50 px-3 py-2">
                <p className="text-[11px] uppercase text-gray-500">Clinic name</p>
                <p className="font-semibold text-gray-900">{clinic.name}</p>
              </div>
              <div className="grid gap-3">
                <div>
                  <Label htmlFor="ob-phone">Clinic phone</Label>
                  <Input
                    id="ob-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="07XXXXXXXX"
                  />
                </div>
                <div>
                  <Label htmlFor="ob-city">City / town</Label>
                  <Input
                    id="ob-city"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Kampala"
                  />
                </div>
                <div>
                  <Label htmlFor="ob-fee">Default consultation fee (UGX)</Label>
                  <Input
                    id="ob-fee"
                    type="number"
                    min={0}
                    value={form.consultationFee}
                    onChange={(e) => setForm((f) => ({ ...f, consultationFee: e.target.value }))}
                  />
                  <p className="text-xs text-gray-500 mt-1">Used as the starting fee when you log a visit.</p>
                </div>
              </div>
            </div>
          )}

          {step === "workflow" && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-gray-900">How a normal day works</h2>
              <p className="text-sm text-gray-600">Three screens cover most of the work:</p>
              <div className="space-y-3">
                {[
                  { icon: UserPlus, title: "1. Patients", desc: "Register or find the patient before the visit." },
                  { icon: Stethoscope, title: "2. Visits", desc: "Log complaint, notes, labs, and medicines." },
                  { icon: Receipt, title: "3. Billing", desc: "Bill is created with the visit — collect payment or track balance." },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex gap-3 rounded-lg border p-3">
                    <div className="rounded-md bg-green-50 p-2 h-fit">
                      <Icon className="h-4 w-4 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{title}</p>
                      <p className="text-xs text-gray-600">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Appointments and{" "}
                <Pill className="h-3.5 w-3.5 inline" /> Medicines are there when you need them.
              </p>
            </div>
          )}

          {step === "team" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <UserPlus className="h-5 w-5" />
                <h2 className="text-xl font-bold text-gray-900">Your team</h2>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                You are the <strong>manager</strong>. Invite receptionists and doctors from{" "}
                <strong>Staff</strong> when you are ready — each person only sees what their role needs.
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Free plan includes <strong>1 staff seat</strong> (you). Upgrade later if you need more people on the system.
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => finish("/staff")}
                disabled={completeMutation.isPending}
              >
                Invite staff now
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <p className="text-xs text-center text-gray-500">Or continue setup and invite later.</p>
            </div>
          )}

          {step === "plan" && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-gray-900">You&apos;re on the Free plan</h2>
              <p className="text-sm text-gray-600">
                Start free. When you need more capacity, pay with <strong>MTN Mobile Money</strong> and submit a request under Settings — we activate your plan after confirming payment.
              </p>
              <ul className="text-sm space-y-2 text-gray-700">
                <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" /> Free: limited patients & visits per month</li>
                <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" /> Clinic / Pro: unlock more staff, reports, inventory</li>
                <li className="flex gap-2 items-start">
                  <Smartphone className="h-4 w-4 text-green-600 mt-0.5" />
                  <span>MoMo <strong>reason</strong> = your clinic name exactly: <em>{clinic.name}</em></span>
                </li>
              </ul>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center py-2">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">You&apos;re ready</h2>
              <p className="text-sm text-gray-600">
                Register your first patient, then log a visit when they come in. CareDesk will handle the bill.
              </p>
              <div className="grid gap-2">
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={completeMutation.isPending}
                  onClick={() => finish("/patients")}
                >
                  {completeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add first patient
                </Button>
                <Button variant="outline" disabled={completeMutation.isPending} onClick={() => finish("/dashboard")}>
                  Go to dashboard
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        {step !== "done" && (
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-between gap-2">
            <Button
              variant="ghost"
              disabled={stepIndex === 0 || updateMutation.isPending || completeMutation.isPending}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            {step === "clinic" ? (
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={updateMutation.isPending}
                onClick={() => void saveClinicAndNext()}
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save & continue
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))}
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
