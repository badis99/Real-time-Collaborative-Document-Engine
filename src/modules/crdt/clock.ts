export class Clock {
    private value: number;

    constructor() {
        this.value = 0;
    }

    public getValue(): number {
        return this.value;
    }

    public tick(): number {
        this.value++;
        return this.value;
    }

    public update(receivedClock: number): void {
        this.value = Math.max(this.value, receivedClock) + 1;
    }
}