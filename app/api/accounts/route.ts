import { NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/accounts — list connected social accounts and profiles
export async function GET() {
  try {
    // Fetch both accounts and profiles in parallel
    const [accountsData, profilesData] = await Promise.all([
      lateApiFetch("/accounts"),
      lateApiFetch("/profiles"),
    ]);

    return NextResponse.json({
      accounts: accountsData.accounts || [],
      profiles: profilesData.profiles || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
