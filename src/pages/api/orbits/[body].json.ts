import type { APIRoute } from "astro";

const BODY_IDS: Record<string, string> = {
    mercury: "199",
    venus: "299",
    earth: "399",
    mars: "499",
    jupiter: "599",
    saturn: "699",
    uranus: "799",
    neptune: "899",
};

const DAY_MS = 86_400_000;
const TDB_MINUS_UTC_MS = 69_184; // Current-era approximation

function horizonsDate(date: Date): string {
    return date.toISOString().replace("T", " ").slice(0, 19);
}

export const GET: APIRoute = async ({ params }) => {
    const name = params.body?.toLowerCase();
    const id = name ? BODY_IDS[name] : undefined;

    if (!id) {
        return Response.json({ error: "Unknown planet" }, { status: 404 });
    }

    const epochUtc = new Date();
    const startTdb = new Date(epochUtc.getTime() + TDB_MINUS_UTC_MS);
    const stopTdb = new Date(startTdb.getTime() + DAY_MS);

    const query = new URLSearchParams({
        format: "json",
        COMMAND: `'${id}'`,
        OBJ_DATA: "NO",
        MAKE_EPHEM: "YES",
        EPHEM_TYPE: "ELEMENTS",
        CENTER: "'500@10'",
        REF_PLANE: "ECLIPTIC",
        REF_SYSTEM: "ICRF",
        OUT_UNITS: "AU-D",
        TIME_TYPE: "TDB",
        START_TIME: `'${horizonsDate(startTdb)}'`,
        STOP_TIME: `'${horizonsDate(stopTdb)}'`,
        STEP_SIZE: "'1 d'",
        CSV_FORMAT: "YES",
        ELM_LABELS: "NO",
    });

    const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${query}`;

    let result: { result?: string; error?: string } | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
                throw new Error(`Horizons HTTP ${response.status}`);
            }

            const payload = await response.json() as {
                result?: string;
                error?: string;
            };

            if (payload.error || !payload.result) {
                throw new Error(
                    payload.error ?? "Horizons returned no result"
                );
            }

            result = payload;
            break;
        } catch (error) {
            console.error(
                `[Horizons: ${name}] Attempt ${attempt}/3 failed:`,
                error
            );

            if (attempt < 3) {
                await new Promise(resolve =>
                    setTimeout(resolve, attempt * 1000)
                );
            }
        }
    }

    if (!result?.result) {
        return Response.json(
            { error: "Horizons unavailable after three attempts" },
            { status: 502 }
        );
    }

    if (result.error || !result.result) {
        console.error(`[Horizons: ${name}] API error`, {
            error: result.error,
            resultPreview: result.result?.slice(0, 1500),
        });

        return Response.json(
            { error: result.error ?? "Missing Horizons data" },
            { status: 502 }
        );
    }

    const section = result.result.split("$$SOE")[1]?.split("$$EOE")[0];

    const row = section?.split(/\r?\n/).map(line => line.trim()).find(line => {
        const fields = line.split(",");
        return fields.length >= 14 && Number.isFinite(Number(fields[0]));
    });

    if (!row) {
        console.error(`[Horizons: ${name}] No CSV row found`, {
            hasSection: Boolean(section),
            resultPreview: result.result?.slice(0, 2500),
        });

        return Response.json(
            { error: "Could not parse orbital elements" },
            { status: 502 }
        );
    }

    const fields = row.split(",").map(value => value.trim());

    const numberAt = (index: number) => Number(fields[index]);

    const elements = {
        epochJD: numberAt(0),
        eccentricity: numberAt(2),
        inclinationDeg: numberAt(4),
        ascendingNodeDeg: numberAt(5),
        argumentPeriapsisDeg: numberAt(6),
        meanAnomalyDeg: numberAt(9),
        semiMajorAxisAU: numberAt(11),
        periodDays: numberAt(13),
    };

    console.error(`[Horizons: ${name}]`, {
        rawRow: row,
        fields,
        elements,
        checks: {
            finite: Object.fromEntries(
                Object.entries(elements).map(([key, value]) => [
                    key,
                    Number.isFinite(value),
                ])
            ),
            eccentricityValid:
                elements.eccentricity >= 0 &&
                elements.eccentricity < 1,
            semiMajorAxisValid: elements.semiMajorAxisAU > 0,
            periodValid: elements.periodDays > 0,
        },
    });

    const numericValues = Object.values(elements);

    if (
        fields.length < 14 ||
        !numericValues.every(Number.isFinite) ||
        elements.eccentricity < 0 ||
        elements.eccentricity >= 1 ||
        elements.semiMajorAxisAU <= 0 ||
        elements.periodDays <= 0
    ) {
        console.error("Invalid orbital elements", { fields, elements });

        console.error(`[Horizons: ${name}]`, {
            rawRow: row,
            fields,
            elements,
            checks: {
                finite: Object.fromEntries(
                    Object.entries(elements).map(([key, value]) => [
                        key,
                        Number.isFinite(value),
                    ])
                ),
                eccentricityValid:
                    elements.eccentricity >= 0 &&
                    elements.eccentricity < 1,
                semiMajorAxisValid: elements.semiMajorAxisAU > 0,
                periodValid: elements.periodDays > 0,
            },
        });

        return Response.json(
            { error: "Invalid orbital elements" },
            { status: 502 }
        );
    }

    return Response.json({
        name,
        epochUtc: epochUtc.toISOString(),
        elements,
    });
};