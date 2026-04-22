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
    flagsAtLevel: number;
    vouchedBy?: string;
}

export interface CachedMessage {
    hash: number;
    roomId: string;
    timestamp: number;
    normalized: string;
}

export const COOLDOWN_DURATIONS: Record<ChaosLevel, number> = {
    [ChaosLevel.Clean]: 0,
    [ChaosLevel.Warning]: 0,
    [ChaosLevel.Cooldown]: 60_000,
    [ChaosLevel.Restricted]: 600_000,
    [ChaosLevel.AdminReview]: 0,
};

export const ESCALATION_THRESHOLDS: Record<ChaosLevel, number> = {
    [ChaosLevel.Clean]: 3,
    [ChaosLevel.Warning]: 3,
    [ChaosLevel.Cooldown]: 2,
    [ChaosLevel.Restricted]: 2,
    [ChaosLevel.AdminReview]: Infinity,
};

export type FlagTrigger = 'duplicate' | 'polymorphic-spam' | 'cross-channel' | 'rate-flood' | 'room-spread' | 'url-spam';
export type FlagAction = 'warning' | 'cooldown' | 'restricted' | 'admin-review';

export interface FlagLogEntry {
    userId: string;
    username: string;
    roomId: string;
    roomName: string;
    messageText: string;
    trigger: FlagTrigger;
    chaosLevel: ChaosLevel;
    timestamp: number;
    action: FlagAction;
}

export interface DailyFlagSummary {
    userId: string;
    username: string;
    date: string;
    flagCount: number;
    triggers: Record<string, number>;
    actions: Record<string, number>;
    rooms: string[];
}

export const CHAOS_LABELS: Record<ChaosLevel, string> = {
    [ChaosLevel.Clean]: 'Clean',
    [ChaosLevel.Warning]: 'Warning',
    [ChaosLevel.Cooldown]: 'Cooldown (1 min)',
    [ChaosLevel.Restricted]: 'Restricted (10 min)',
    [ChaosLevel.AdminReview]: 'Admin Review',
};
