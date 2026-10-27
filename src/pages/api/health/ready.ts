import type { APIRoute } from "astro";
import { solarSystemReady } from "../../../scripts/solar-system";

export const GET: APIRoute = async () => {
    if (!solarSystemReady) {
        return new Response(JSON.stringify({
            status: 'starting'
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}