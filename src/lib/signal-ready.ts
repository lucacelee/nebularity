export class Readiness {
    private static solarSystemReady: boolean = true;

    public static setReady(): void {
        this.solarSystemReady = true;
    }

    public static isReady(): boolean {
        return this.solarSystemReady;
    }
}