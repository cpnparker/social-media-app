import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/accounts/connect?platform=twitter&profileId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const profileId = searchParams.get("profileId");

  if (!platform) {
    return NextResponse.json(
      { error: "platform is required" },
      { status: 400 }
    );
  }

  try {
    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accounts?connected=true`;

    const data = await lateApiFetch(
      `/connect/${platform}?${profileId ? `profileId=${profileId}&` : ""}redirectUrl=${encodeURIComponent(redirectUrl)}`
    );

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
