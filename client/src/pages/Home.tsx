import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Activity, Users, TrendingUp, Pill, Calendar, Shield, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { getLoginUrl, REGISTER_PATH } from "@/const";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading CareDesk...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">

      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="CareDesk" className="w-8 h-8 rounded-md object-cover" />
            <span className="text-2xl font-bold text-gray-900">CareDesk</span>
          </div>
          <Link href={getLoginUrl()} className="text-green-600 hover:text-green-700 font-medium">
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 mb-6">
              Clinic Management Built for Uganda
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Register patients, record visits, track medicines, and monitor revenue — all in UGX, from your phone or computer. Designed so any receptionist or clinician can use it on day one.
            </p>
            <div className="flex gap-4">
              <Link href={REGISTER_PATH}>
                <Button size="lg" className="bg-green-600 hover:bg-green-700">
                  Start for Free
                </Button>
              </Link>
              <Link href={getLoginUrl()}>
                <Button size="lg" variant="outline">Sign In</Button>
              </Link>
            </div>
            <p className="text-sm text-gray-500 mt-4">Free plan available. No credit card required.</p>
          </div>
          <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-2xl p-8 h-80 flex items-center justify-center">
            <div className="text-center">
              <Activity className="w-20 h-20 text-green-600 mx-auto mb-4 opacity-40" />
              <p className="text-gray-500 font-medium">CareDesk Dashboard</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white py-20 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-12 text-center">
            Everything your clinic needs
          </h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-8">
            {[
              { icon: Users, title: "Patient Management", desc: "Register patients with auto-generated IDs, track medical history, allergies, and next-of-kin. Search by name or phone." },
              { icon: Activity, title: "Visits & Billing", desc: "Record consultations, prescribe drugs, order lab tests, and generate itemised bills automatically — all in one flow." },
              { icon: Pill, title: "Medicines", desc: "Track stock levels, get low-stock alerts, and automatically deduct medicines when prescribed during a visit." },
              { icon: TrendingUp, title: "Revenue Reports", desc: "Daily reconciliation, collection rates, revenue by type (consultation, lab, medicines), and doctor performance." },
              { icon: Calendar, title: "Appointments", desc: "Schedule patient appointments, manage walk-ins, and send SMS reminders via Africa's Talking." },
              { icon: Shield, title: "Simple Roles", desc: "Receptionist, doctor, and manager roles. Each staff member sees only what they need — no complicated setup." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-md transition">
                <Icon className="w-10 h-10 text-green-600 mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-600 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center">Simple, honest pricing</h2>
          <p className="text-center text-gray-500 mb-12">Start free. Upgrade when you're ready.</p>

          <div className="grid md:grid-cols-3 gap-6">

            {/* Free */}
            <div className="rounded-xl border-2 border-gray-200 bg-white p-7">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Free</h3>
              <p className="text-3xl font-bold text-gray-800 mb-1">UGX 0</p>
              <p className="text-xs text-gray-500 mb-6">Forever free</p>
              <ul className="space-y-2 mb-8">
                {["1 staff member", "30 new patients/month", "30 visits/month", "Billing & invoicing", "Appointments", "Basic patient records"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-gray-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href={REGISTER_PATH}>
                <Button className="w-full" variant="outline">Get started</Button>
              </Link>
            </div>

            {/* Clinic */}
            <div className="rounded-xl border-2 border-green-500 bg-green-50 shadow-lg p-7">
              <div className="bg-green-600 text-white px-2.5 py-0.5 rounded-full text-xs font-semibold inline-block mb-3">Most popular</div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Clinic</h3>
              <p className="text-3xl font-bold text-green-700 mb-1">UGX 90,000<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-xs text-green-700 font-medium mb-6">≈ UGX 3,000/day — less than a lunch</p>
              <ul className="space-y-2 mb-8">
                {["Up to 5 staff", "Unlimited patients", "Drug inventory management", "Revenue reports", "SMS logs & activity audit", "Debt reminders via SMS"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href={`${REGISTER_PATH}?plan=clinic`}>
                <Button className="w-full bg-green-600 hover:bg-green-700">Get started</Button>
              </Link>
            </div>

            {/* Pro */}
            <div className="rounded-xl border-2 border-purple-400 bg-purple-50 p-7">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Pro</h3>
              <p className="text-3xl font-bold text-purple-700 mb-1">UGX 180,000<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-xs text-gray-500 mb-6">For growing clinic groups</p>
              <ul className="space-y-2 mb-8">
                {["Unlimited staff", "Unlimited patients", "Unlimited branches", "All Clinic features", "Bulk SMS appointment reminders", "Multi-branch management"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle className="w-4 h-4 text-purple-500 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href={`${REGISTER_PATH}?plan=pro`}>
                <Button className="w-full bg-purple-600 hover:bg-purple-700">Get started</Button>
              </Link>
            </div>
          </div>

          <div className="mt-10 bg-white border border-gray-200 rounded-xl p-6 max-w-2xl mx-auto text-center">
            <p className="text-gray-700 font-medium mb-2">💡 To put it in perspective</p>
            <p className="text-gray-600 text-sm">A clinic seeing just <strong>3 patients a day</strong> at UGX 20,000 consultation fee earns UGX 1,800,000/month. CareDesk Clinic costs less than <strong>5% of one day's revenue</strong> to run the entire clinic.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-green-600 text-white py-16">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-3xl font-bold mb-4">Ready to run a better clinic?</h2>
          <p className="text-lg mb-8 text-green-100">
            Join clinics across Uganda using CareDesk to manage patients, billing, and staff from one place.
          </p>
          <Link href={REGISTER_PATH}>
            <Button size="lg" className="bg-white text-green-600 hover:bg-gray-100">
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p>&copy; 2026 CareDesk. Built for Ugandan clinics.</p>
        </div>
      </footer>
    </div>
  );
}
