import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import {
    RocketChatAssociationModel,
    RocketChatAssociationRecord,
} from '@rocket.chat/apps-engine/definition/metadata';
import { ChaosLevel, COOLDOWN_DURATIONS, UserChaosRecord } from '../types';

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
        };

        const newLevel = Math.min(current.chaosLevel + 1, ChaosLevel.AdminReview) as ChaosLevel;
        const duration = COOLDOWN_DURATIONS[newLevel];
        const now = Date.now();

        const updated: UserChaosRecord = {
            userId,
            username,
            chaosLevel: newLevel,
            cooldownUntil: duration > 0 ? now + duration : 0,
            lastEscalation: now,
            totalFlags: current.totalFlags + 1,
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
            vouchedBy: adminUsername,
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
