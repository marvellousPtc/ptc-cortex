import { NextRequest } from "next/server";
import { getCurrentUserId, isDeveloperRequest } from "@/lib/auth-check";
import { getUsageInfo } from "@/lib/db";

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return new Response(
      JSON.stringify({ authenticated: false, used: 0, limit: 20, remaining: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const isDeveloper = isDeveloperRequest(request);
  const info = await getUsageInfo(userId, { isDeveloper });
  return new Response(
    JSON.stringify({ authenticated: true, ...info }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
