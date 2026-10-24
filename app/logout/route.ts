/** GET /logout — drop this device's session cookie (fork addition, 2026-10-24). */
import { COOKIE } from "@/lib/login-gate";

export const dynamic = "force-dynamic";

export async function GET() {
	return new Response(null, {
		status: 303,
		headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
	});
}
