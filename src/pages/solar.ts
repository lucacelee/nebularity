import type { APIRoute } from "astro";
import fetch from "node-fetch";

export const GET: APIRoute = async () => {
    let key: string = process.env.NB_LE_SYSTEME_SOLAIR_API_KEY ?? '';
    let apiHeaders: Headers = new Headers({'Authorization': `Bearer ${key}`});
    const response = await fetch('https://api.le-systeme-solaire.net/rest/bodies', { headers: apiHeaders });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    return new Response(await response.text(), { status: 200, headers: { 'Content-Type': 'application/json' } });
}