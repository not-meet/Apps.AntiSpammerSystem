export enum ChaosLevel {
    Clean = 0,
    Warning = 1,
    Cooldown = 2,
    Restricted = 3,
    AdminReview = 4,
}

export interface UserChaosRecord {
    userId: string;
    username: string;
    chaosLevel: ChaosLevel;
    cooldownUntil: number;
    lastEscalation: number;
    totalFlags: number;
    vouchedBy?: string;
}

export interface CachedMessage {
    hash: number;
    roomId: string;
    timestamp: number;
}

export const COOLDOWN_DURATIONS: Record<ChaosLevel, number> = {
    [ChaosLevel.Clean]: 0,
    [ChaosLevel.Warning]: 0,
    [ChaosLevel.Cooldown]: 60_000,
    [ChaosLevel.Restricted]: 600_000,
    [ChaosLevel.AdminReview]: Number.MAX_SAFE_INTEGER,
};

export const CHAOS_LABELS: Record<ChaosLevel, string> = {
    [ChaosLevel.Clean]: 'Clean',
    [ChaosLevel.Warning]: 'Warning',
    [ChaosLevel.Cooldown]: 'Cooldown (1 min)',
    [ChaosLevel.Restricted]: 'Restricted (10 min)',
    [ChaosLevel.AdminReview]: 'Admin Review',
};
