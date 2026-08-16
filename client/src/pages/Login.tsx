import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { REGISTER_PATH } from "@/const";

const ROLE_REDIRECT: Record<string, string> = {
  admin: "/owner",
  manager: "/dashboard",
  doctor: "/visits",
  receptionist: "/patients",
};

const emailSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

const otpRequestSchema = z.object({
  phone: z.string().min(7, "Enter a valid phone number"),
});

const otpVerifySchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code"),
  rememberMe: z.boolean().default(false),
});

type EmailForm = z.infer<typeof emailSchema>;
type OtpRequestForm = z.infer<typeof otpRequestSchema>;
type OtpVerifyForm = z.infer<typeof otpVerifySchema>;

function EmailLoginTab() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: { rememberMe: false },
  });

  // If ProtectedRoute sent us here with a redirect param, honour it after login.
  const redirectAfterLogin = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get("redirect");
      return p && p.startsWith("/") ? p : null;
    } catch { return null; }
  })();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      navigate(redirectAfterLogin ?? ROLE_REDIRECT[data.role] ?? "/dashboard");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => loginMutation.mutate(d))} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} placeholder="you@clinic.com" />
        {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-green-600 hover:text-green-700">
            Forgot password?
          </Link>
        </div>
        <Input id="password" type="password" {...register("password")} placeholder="Your password" />
        {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="rememberMe"
          checked={watch("rememberMe")}
          onCheckedChange={(c) => setValue("rememberMe", c === true)}
        />
        <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
          Remember this device for a year
        </Label>
      </div>
      <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loginMutation.isPending}>
        {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
      </Button>
    </form>
  );
}

function PhoneLoginTab() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [phase, setPhase] = useState<"phone" | "code">("phone");
  const [phone, setPhoneState] = useState("");

  const phoneForm = useForm<OtpRequestForm>({ resolver: zodResolver(otpRequestSchema) });
  const otpForm = useForm<OtpVerifyForm>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { rememberMe: false },
  });

  const requestOtp = trpc.auth.requestOtp.useMutation({
    onSuccess: () => {
      setPhoneState(phoneForm.getValues("phone"));
      setPhase("code");
      toast.success("A 6-digit code was sent to your phone");
    },
    onError: (e) => toast.error(e.message),
  });

  const verifyOtp = trpc.auth.verifyOtp.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      navigate(ROLE_REDIRECT[data.role] ?? "/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  if (phase === "phone") {
    return (
      <form onSubmit={phoneForm.handleSubmit((d) => requestOtp.mutate(d))} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" type="tel" {...phoneForm.register("phone")} placeholder="07XXXXXXXX" />
          {phoneForm.formState.errors.phone && (
            <p className="text-sm text-red-600">{phoneForm.formState.errors.phone.message}</p>
          )}
        </div>
        <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={requestOtp.isPending}>
          {requestOtp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={otpForm.handleSubmit((d) => verifyOtp.mutate({ ...d, phone }))} className="space-y-4">
      <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to {phone}</p>
      <div className="space-y-2">
        <Label htmlFor="code">Verification code</Label>
        <Input id="code" {...otpForm.register("code")} placeholder="123456" maxLength={6} />
        {otpForm.formState.errors.code && (
          <p className="text-sm text-red-600">{otpForm.formState.errors.code.message}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="rememberMeOtp"
          checked={otpForm.watch("rememberMe")}
          onCheckedChange={(c) => otpForm.setValue("rememberMe", c === true)}
        />
        <Label htmlFor="rememberMeOtp" className="text-sm font-normal cursor-pointer">
          Remember this device for a year
        </Label>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => setPhase("phone")}>
          Back
        </Button>
        <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={verifyOtp.isPending}>
          {verifyOtp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & sign in"}
        </Button>
      </div>
      <Button
        type="button" variant="ghost" className="w-full text-xs"
        disabled={requestOtp.isPending}
        onClick={() => requestOtp.mutate({ phone })}
      >
        {requestOtp.isPending ? "Sending..." : "Resend code"}
      </Button>
    </form>
  );
}

export default function Login() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isAuthenticated || loading) return;
    // Honour ?redirect= here too — a user can land on /login while already
    // authenticated (e.g. a stale second tab, or clicking an old "session
    // expired" link after logging back in elsewhere). Without this, that case
    // always bounced to /dashboard regardless of where they were headed.
    const p = new URLSearchParams(window.location.search).get("redirect");
    navigate(p && p.startsWith("/") ? p : "/dashboard");
  }, [isAuthenticated, loading, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo.png" alt="CareDesk" className="w-9 h-9 rounded-md object-cover" />
          <span className="text-2xl font-bold text-foreground">CareDesk</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Welcome back. Use your email or phone number to open your clinic.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="email">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="email" className="flex-1 gap-1.5">
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="phone" className="flex-1 gap-1.5">
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                  Phone
                </TabsTrigger>
              </TabsList>
              <TabsContent value="email"><EmailLoginTab /></TabsContent>
              <TabsContent value="phone"><PhoneLoginTab /></TabsContent>
            </Tabs>

            <p className="text-sm text-muted-foreground text-center mt-6">
              New to CareDesk?{" "}
              <Link href={REGISTER_PATH} className="text-green-600 hover:text-green-700 font-medium">
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center mt-6">
          <Link href="/" className="text-sm text-muted-foreground hover:text-muted-foreground">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
