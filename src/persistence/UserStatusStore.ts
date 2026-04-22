import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import {
    RocketChatAssociationModel,
    RocketChatAssociationRecord,
} from '@rocket.chat/apps-engine/definition/metadata';
import { ChaosLevel, COOLDOWN_DURATIONS, ESCALATION_THRESHOLDS, UserChaosRecord } from '../types';

const ASSOC_SCOPE = 'antispam-chaos';

export class UserStatusStore {
    private static userAssocs(userId: string): RocketChatAssociationRecord[] {
        return [
            new RocketChatAssociationRecord(RocketChatAssociationModel.USER, userId),
            new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, ASSOC_SCOPE),
        ];
    }

    private static scopeAssoc(): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, ASSOC_SCOPE);
    }

    public static async get(read: IRead, userId: string): Promise<UserChaosRecord | null> {
        const records = await read.getPersistenceReader().readByAssociations(
            UserStatusStore.userAssocs(userId),
        );
        return records.length ? records[0] as UserChaosRecord : null;
    }

    public static async getAll(read: IRead): Promise<UserChaosRecord[]> {
        const records = await read.getPersistenceReader().readByAssociation(
            UserStatusStore.scopeAssoc(),
        );
        return (records as UserChaosRecord[]).filter((r) => r.chaosLevel !== undefined);
    }

    public static async save(
        persistence: IPersistence,
        userId: string,
        record: UserChaosRecord,
    ): Promise<void> {
        await persistence.updateByAssociations(
            UserStatusStore.userAssocs(userId),
            record,
            true,
        );
    }

    public static async escalate(
        read: IRead,
        persistence: IPersistence,
        userId: string,
        username: string,
    ): Promise<UserChaosRecord> {
        const existing = await UserStatusStore.get(read, userId);
        const current = existing || {
            userId,
            username,
            chaosLevel: ChaosLevel.Clean,
            cooldownUntil: 0,
            lastEscalation: 0,
            totalFlags: 0,
            flagsAtLevel: 0,
        };

        const now = Date.now();
        const newFlagsAtLevel = (current.flagsAtLevel || 0) + 1;
        const threshold = ESCALATION_THRESHOLDS[current.chaosLevel];
        const shouldEscalate = newFlagsAtLevel >= threshold
            && current.chaosLevel < ChaosLevel.AdminReview;

        if (shouldEscalate) {
            const newLevel = (current.chaosLevel + 1) as ChaosLevel;
            const duration = COOLDOWN_DURATIONS[newLevel];

            const updated: UserChaosRecord = {
                userId,
                username,
                chaosLevel: newLevel,
                cooldownUntil: duration > 0 ? now + duration : 0,
                lastEscalation: now,
                totalFlags: current.totalFlags + 1,
                flagsAtLevel: 0,
            };
            await UserStatusStore.save(persistence, userId, updated);
            return updated;
        }

        const updated: UserChaosRecord = {
            userId,
            username,
            chaosLevel: current.chaosLevel,
            cooldownUntil: current.cooldownUntil,
            lastEscalation: now,
            totalFlags: current.totalFlags + 1,
            flagsAtLevel: newFlagsAtLevel,
        };
        await UserStatusStore.save(persistence, userId, updated);
        return updated;
    }

    public static async reset(
        persistence: IPersistence,
        userId: string,
        username: string,
        adminUsername: string,
    ): Promise<void> {
        await UserStatusStore.save(persistence, userId, {
            userId,
            username,
            chaosLevel: ChaosLevel.Clean,
            cooldownUntil: 0,
            lastEscalation: 0,
            totalFlags: 0,
            flagsAtLevel: 0,
            vouchedBy: adminUsername,
        });
    }

    public static async resetCooldown(
        read: IRead,
        persistence: IPersistence,
        userId: string,
    ): Promise<void> {
        const existing = await UserStatusStore.get(read, userId);
        if (!existing) { return; }

        await UserStatusStore.save(persistence, userId, {
            ...existing,
            cooldownUntil: 0,
        });
    }

    public static async isRestricted(
        read: IRead,
        persistence: IPersistence,
        userId: string,
    ): Promise<{ restricted: boolean; record: UserChaosRecord | null }> {
        const record = await UserStatusStore.get(read, userId);
        if (!record) { return { restricted: false, record: null }; }

        if (record.chaosLevel === ChaosLevel.AdminReview) {
            return { restricted: true, record };
        }

        if (record.cooldownUntil > 0 && Date.now() < record.cooldownUntil) {
            return { restricted: true, record };
        }

        if (record.cooldownUntil > 0 && Date.now() >= record.cooldownUntil) {
            const lifted: UserChaosRecord = { ...record, cooldownUntil: 0 };
            await UserStatusStore.save(persistence, userId, lifted);
            return { restricted: false, record: lifted };
        }

        return { restricted: false, record };
    }
}
