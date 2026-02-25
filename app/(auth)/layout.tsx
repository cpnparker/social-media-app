export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding with cover image */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{
          backgroundImage: "url('/assets/cover_login.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-[#023250]/55" />
        {/* Subtle gradient for text legibility at bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#011a2e]/80 via-transparent to-[#023250]/30" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo_engine_text_white.png"
              alt="The Content Engine"
              width={250}
              height={30}
              className="h-[30px] w-auto"
            />
          </div>

          {/* Tagline */}
          <div className="space-y-6">
            <blockquote className="text-white/95 text-3xl font-semibold leading-snug max-w-lg">
              Manage all your social media from one powerful dashboard.
            </blockquote>
            <p className="text-white/60 text-lg max-w-md">
              Schedule posts, track analytics, manage your inbox, and grow your
              audience — across 13 platforms.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                "Twitter",
                "Instagram",
                "LinkedIn",
                "TikTok",
                "Facebook",
              ].map((platform) => (
                <span
                  key={platform}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/10 backdrop-blur-sm"
                >
                  {platform}
                </span>
              ))}
              <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/10 backdrop-blur-sm">
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
