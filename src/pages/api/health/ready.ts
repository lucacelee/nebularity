import type { APIRoute } from "astro";
import { Readiness } from "../../../lib/signal-ready";

export const GET: APIRoute = async () => {
    const up: boolean = Readiness.isReady();
    if (!up) {
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