// client/src/pages/auth/Login.jsx
import React, { useState } from "react";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";
import { api } from "../utils/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [userName, setUserName] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.post("/api/users/login", { email, password });

      console.log("Login response:", res.data); // Debug log

      // ✅ Store token
      if (res.data.token) {
        localStorage.setItem("token", res.data.token);
      }

      // ✅ Store user data
      const userData = {
        id: res.data.id,
        email: res.data.email,
        name: res.data.name,
        jobRole: res.data.jobRole,
      };
      localStorage.setItem("user", JSON.stringify(userData));

      // Extract user name for welcome message
      setUserName(res.data.name || res.data.email.split("@")[0]);
      setShowSuccess(true);

      // Navigate based on user role after showing success message
      setTimeout(() => {
        // ✅ Check user role and redirect accordingly
        const userRole = res.data.jobRole;

        // 🔍 Debug log to see what role we got
        console.log("User role from API:", userRole);
        console.log("User role type:", typeof userRole);

        // ✅ Case-insensitive check for admin role
        if (userRole && userRole.toString().toLowerCase() === "admin") {
          console.log("Redirecting to /admin");
          window.location.href = "/admin"; // Admin users → Admin panel
        } else {
          console.log("Redirecting to /dashboard");
          window.location.href = "/dashboard"; // Regular users → Dashboard
        }
      }, 2000);
    } catch (err) {
      console.error("Login error:", err); // Debug log
      setError(
        err.response?.data?.error || "Login failed. Please check your credentials."
      );
      setLoading(false);
    }
  };

  const styles = `
    /* Page backdrop */
    .abc-page {
      background: linear-gradient(135deg, #cfe4fd 0%, #bfdcfb 45%, #a9d0fa 100%);
    }

    /* Dot grid texture on the brand panel */
    .abc-dots {
      background-image: radial-gradient(rgba(255, 255, 255, 0.28) 1.6px, transparent 1.6px);
      background-size: 15px 15px;
    }

    /* 3D spheres */
    .abc-sphere {
      background: radial-gradient(circle at 32% 28%, #bfdbfe, #3b82f6 45%, #1d4ed8 75%, #16358f);
      box-shadow: -10px 14px 28px rgba(8, 24, 68, 0.45), inset -6px -6px 16px rgba(8, 24, 68, 0.35);
    }

    /* Glass card over the navy panel */
    .abc-glass {
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 25px 50px -12px rgba(6, 20, 60, 0.55);
    }

    .abc-cta {
      background: linear-gradient(90deg, #1d4ed8 0%, #2563eb 55%, #1e6fe8 100%);
    }
    .abc-cta:hover:not(:disabled) {
      background: linear-gradient(90deg, #1a44bf 0%, #2059d6 55%, #1a63d6 100%);
    }

    @keyframes abc-rise {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .abc-rise { animation: abc-rise 0.5s ease-out both; }

    @keyframes abc-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-6px); }
      75% { transform: translateX(6px); }
    }
    .abc-shake { animation: abc-shake 0.4s ease-in-out; }

    @media (prefers-reduced-motion: reduce) {
      .abc-rise, .abc-shake { animation: none; }
    }
  `;

  /* ---------- Left brand panel (shared by both screens) ---------- */
  const BrandPanel = () => (
    <div className="relative w-full md:w-[58%] min-h-[420px] md:min-h-[680px] rounded-t-[22px] md:rounded-tr-none md:rounded-l-[22px] z-10">
      {/* Clipped navy background with flat overlapping shapes */}
      <div className="absolute inset-0 rounded-t-[22px] md:rounded-tr-none md:rounded-l-[22px] overflow-hidden bg-[#0a1f56]">
        <div className="absolute -left-24 top-[18%] w-[520px] h-[520px] rounded-[120px] bg-[#1b4ed1]/60 rotate-45" />
        <div className="absolute -left-40 top-[24%] w-[440px] h-[440px] rounded-full border-[46px] border-[#2563eb]/70" />
        <div className="absolute -left-28 top-[40%] w-[300px] h-[300px] rounded-full border-[30px] border-[#1e40af]/80" />
        <div className="absolute -right-28 -top-20 w-[320px] h-[320px] rounded-full border-[52px] border-[#1d4ed8]/70" />
        <div className="absolute right-[-90px] top-[34%] w-[260px] h-[260px] rounded-full bg-[#1e50d6]/55" />
        <div className="absolute right-[-60px] bottom-[-40px] w-[240px] h-[240px] rounded-[70px] bg-[#123a9e]/80 rotate-12" />
        {/* Dot grids */}
        <div className="abc-dots absolute left-6 top-[20%] w-24 h-20 opacity-70" />
        <div className="abc-dots absolute right-8 bottom-[14%] w-28 h-24 opacity-60" />
      </div>

      {/* Unclipped 3D spheres that pop over the edges */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="abc-sphere absolute -top-10 -left-8 w-[118px] h-[118px] rounded-full z-20" />
        <div className="abc-sphere absolute top-[45%] -right-7 w-[62px] h-[62px] rounded-full z-20" />
        <div className="abc-sphere absolute bottom-[22%] -left-6 w-[74px] h-[74px] rounded-full z-20" />
        <div className="abc-sphere absolute bottom-[0%] -right-8 w-[54px] h-[54px] rounded-full z-20" />
      </div>

      {/* Glass brand card */}
      <div className="relative z-30 flex h-full items-center justify-center p-6 sm:p-10">
        <div className="abc-glass relative w-full max-w-[380px] rounded-[26px] px-8 py-10 text-white overflow-hidden">
          <div className="absolute -left-14 top-1/3 w-52 h-52 bg-[#3b82f6] rounded-full mix-blend-screen blur-[70px] opacity-60 pointer-events-none" />
          <div className="absolute -right-14 bottom-1/4 w-52 h-52 bg-[#60a5fa] rounded-full mix-blend-screen blur-[70px] opacity-45 pointer-events-none" />

          <div className="relative z-10">
            {/* Logo */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-[#f0b429]/40 blur-2xl" />
                <img
                  src="/images/icon.png"
                  alt="Abacco Technology"
                  className="relative w-[92px] h-[92px] object-contain drop-shadow-[0_8px_20px_rgba(6,20,60,0.45)]"
                />
              </div>
            </div>

            {/* Brand name */}
            <div className="mt-4 text-center">
              <p className="text-[26px] sm:text-[28px] font-bold tracking-tight leading-tight">
                Abacco Technology
              </p>
              <p className="mt-1 text-[12px] font-medium tracking-[0.18em] text-white/80">
                Marketing Campaign CRM
              </p>
            </div>

            {/* Divider */}
            <div className="my-7 flex items-center justify-center gap-4">
              <span className="h-px w-16 bg-white/30" />
              <span className="h-px w-16 bg-white/30" />
            </div>

            {/* Headline */}
            <h2 className="text-[30px] sm:text-[34px] font-bold leading-[1.12] tracking-tight text-center">
               
              <span className="text-[#fff]">Start Campaigning</span>
            </h2>

            <p className="mt-5 text-[14px] leading-relaxed text-white/80 max-w-[280px] text-center mx-auto">
              Sign in with your Abacco credentials to continue managing your campaigns and get leads.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------- Decorative page backdrop ---------- */
  const Backdrop = () => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute -left-32 -top-40 w-[560px] h-[560px] rounded-[160px] bg-white/25 rotate-[28deg]" />
      <div className="absolute -left-56 bottom-[-180px] w-[620px] h-[620px] rounded-full border-[70px] border-white/20" />
      <div className="absolute -right-40 -top-48 w-[520px] h-[520px] rounded-full border-[40px] border-white/30" />
      <div className="absolute -right-24 top-[38%] w-[420px] h-[420px] rounded-full border-[52px] border-[#7cb6f7]/40" />
      <div className="absolute right-[6%] bottom-[-140px] w-[360px] h-[360px] rounded-full bg-white/20" />
    </div>
  );

  // ================= SUCCESS SCREEN =================
  if (showSuccess) {
    return (
      <>
        <style>{styles}</style>
        <div className="abc-page relative min-h-[100dvh] w-full flex items-center justify-center p-4 sm:p-8 md:p-10 overflow-hidden">
          <Backdrop />
          <div className="relative z-10 w-full max-w-[1120px] flex flex-col md:flex-row rounded-[22px] bg-white shadow-[0_40px_80px_-30px_rgba(12,38,94,0.45)]">
            <BrandPanel />

            <div className="w-full md:w-[52%] bg-white rounded-b-[22px] md:rounded-bl-none md:rounded-r-[22px] flex flex-col justify-center px-8 py-14 md:px-14 md:py-20">
              <div className="abc-rise">
                <div className="mb-6 inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50">
                  <svg
                    className="w-8 h-8 text-blue-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h1 className="text-[34px] font-bold tracking-tight text-slate-900">
                  You&apos;re in{userName ? `, ${userName}` : ""}
                </h1>
                <p className="mt-2 text-[15px] text-slate-500">
                  Taking you to your dashboard.
                </p>
                <div className="mt-7 flex items-center gap-2 text-blue-600">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">Loading workspace</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ================= LOGIN FORM =================
  return (
    <>
      <style>{styles}</style>

      <div className="abc-page relative min-h-[100dvh] w-full flex items-center justify-center p-4 sm:p-8 md:p-10 overflow-hidden">
        <Backdrop />

        {/* Card wrapper — no overflow-hidden so the spheres can pop out */}
        <div className="relative z-10 w-full max-w-[1120px] flex flex-col md:flex-row rounded-[22px] bg-white shadow-[0_40px_80px_-30px_rgba(12,38,94,0.45)]">
          <BrandPanel />

          {/* ================= FORM PANEL ================= */}
          <div className="w-full md:w-[52%] bg-white rounded-b-[22px] md:rounded-bl-none md:rounded-r-[22px] flex flex-col justify-center px-8 py-12 md:px-14 md:py-20">
            <h1 className="text-[34px] font-bold tracking-tight text-slate-900">
              Sign in
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-500 max-w-[330px]">
              Welcome back! Please enter your details to continue.
            </p>

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <Mail className="w-[18px] h-[18px] text-blue-600" />
                  </span>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 py-4 text-[15px] text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <Lock className="w-[18px] h-[18px] text-blue-600" />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-12 pr-12 py-4 text-[15px] text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 transition-colors hover:text-blue-600 focus:outline-none focus-visible:text-blue-600"
                  >
                    {showPassword ? (
                      <EyeOff className="w-[18px] h-[18px]" />
                    ) : (
                      <Eye className="w-[18px] h-[18px]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember me / Forgot password */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-[18px] h-[18px] rounded border-2 border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                  />
                  <span className="text-[15px] text-slate-600">Remember me</span>
                </label>
                <a
                  href="/forgot-password"
                  className="text-[15px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Forgot password?
                </a>
              </div>

              {/* Error */}
              {error ? (
                <div
                  role="alert"
                  className="abc-shake rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600"
                >
                  {error}
                </div>
              ) : null}

              {/* Submit */}
              <button
                type="submit"
                disabled={!email || !password || loading}
                className="abc-cta mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-[16px] font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:shadow-blue-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Signing in
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="w-[18px] h-[18px]" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}