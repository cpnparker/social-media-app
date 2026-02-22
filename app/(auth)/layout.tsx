export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[hsl(224,71%,4%)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-transparent to-purple-600/10" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-blue-500 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <span className="text-white text-2xl font-bold tracking-tight">
                The Content Engine
              </span>
            </div>
          </div>

          <div className="space-y-8">
            <blockquote className="text-white/90 text-3xl font-semibold leading-snug max-w-lg">
              Manage all your social media from one powerful dashboard.
            </blockquote>
            <p className="text-white/60 text-lg max-w-md">
              Schedule posts, track analytics, manage your inbox, and grow your
              audience — across 13 platforms.
            </p>
            <div className="flex gap-3">
              {[
                "Twitter",
                "Instagram",
                "LinkedIn",
                "TikTok",
                "Facebook",
              ].map((platform) => (
                <span
                  key={platform}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/10"
                >
                  {platform}
                </span>
              ))}
              <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/10">
                +8 more
              </span>
            </div>
          </div>

          <p className="text-white/30 text-sm">
            © 2026 The Content Engine. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel — auth form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
