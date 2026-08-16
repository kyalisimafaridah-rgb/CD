import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { LOGIN_PATH } from "@/const";

const registerSchema = z.object({
  clinicName: z.string().min(1, "Clinic name is required").max(255),
  name: z.string().min(1, "Your name is required").max(255),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function Register() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // If the person clicked "Get started" on a paid tier's pricing card, carry
  // that intent through registration (accounts always start on Free — a paid
  // tier requires an authenticated clinicId to check out with LemonSqueezy)
  // so Settings can offer the checkout immediately instead of silently
  // dropping them on Free with no trail back to the plan they picked.
  const requestedPlan = new URLSearchParams(window.location.search).get("plan");
  const postAuthPath = requestedPlan === "clinic" || requestedPlan === "pro"
    ? `/settings?upgrade=${requestedPlan}`
    : "/dashboard";

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate(postAuthPath);
    }
  }, [isAuthenticated, loading, navigate, postAuthPath]);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate(postAuthPath);
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (data: RegisterFormData) => {
    registerMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo.png" alt="CareDesk" className="w-9 h-9 rounded-md object-cover" />
          <span className="text-2xl font-bold text-gray-900">CareDesk</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create your clinic account</CardTitle>
            <CardDescription>Free to start — no credit card required. Upgrade anytime.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clinicName">Clinic name</Label>
                <Input id="clinicName" {...register("clinicName")} placeholder="e.g. Sunrise Health Centre" />
                {errors.clinicName && <p className="text-sm text-red-600">{errors.clinicName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" {...register("name")} placeholder="e.g. Dr. Jane Mukasa" />
                {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone number <span className="text-muted-foreground text-xs">(optional, enables SMS login)</span></Label>
                <Input id="phone" type="tel" {...register("phone")} placeholder="07XXXXXXXX" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register("email")} placeholder="you@clinic.com" />
                {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register("password")} placeholder="At least 8 characters" />
                {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
              </div>

              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
              </Button>
            </form>

            <p className="text-sm text-gray-600 text-center mt-6">
              Already have an account?{" "}
              <Link href={LOGIN_PATH} className="text-green-600 hover:text-green-700 font-medium">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center mt-6">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
