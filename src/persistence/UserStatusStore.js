"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserStatusStore = void 0;
const metadata_1 = require("@rocket.chat/apps-engine/definition/metadata");
const types_1 = require("../types");
const ASSOC_SCOPE = 'antispam-chaos';
class UserStatusStore {
    static userAssocs(userId) {
        return [
            new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.USER, userId),
            new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.MISC, ASSOC_SCOPE),
        ];
    }
    static scopeAssoc() {
        return new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.MISC, ASSOC_SCOPE);
    }
    static async get(read, userId) {
        const records = await read.getPersistenceReader().readByAssociations(UserStatusStore.userAssocs(userId));
        return records.length ? records[0] : null;
    }
    static async getAll(read) {
        const records = await read.getPersistenceReader().readByAssociation(UserStatusStore.scopeAssoc());
        return records.filter((r) => r.chaosLevel !== undefined);
    }
    static async save(persistence, userId, record) {
        await persistence.updateByAssociations(UserStatusStore.userAssocs(userId), record, true);
    }
    static async escalate(read, persistence, userId, username) {
        const existing = await UserStatusStore.get(read, userId);
        const current = existing || {
            userId,
            username,
            chaosLevel: types_1.ChaosLevel.Clean,
            cooldownUntil: 0,
            lastEscalation: 0,
            totalFlags: 0,
        };
        const newLevel = Math.min(current.chaosLevel + 1, types_1.ChaosLevel.AdminReview);
        const duration = types_1.COOLDOWN_DURATIONS[newLevel];
        const now = Date.now();
        const updated = {
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
    static async reset(persistence, userId, username, adminUsername) {
        await UserStatusStore.save(persistence, userId, {
            userId,
            username,
            chaosLevel: types_1.ChaosLevel.Clean,
            cooldownUntil: 0,
            lastEscalation: 0,
            totalFlags: 0,
            vouchedBy: adminUsername,
        });
    }
    static async isRestricted(read, persistence, userId) {
        const record = await UserStatusStore.get(read, userId);
        if (!record) {
            return { restricted: false, record: null };
        }
        if (record.chaosLevel === types_1.ChaosLevel.AdminReview) {
            return { restricted: true, record };
        }
        if (record.cooldownUntil > 0 && Date.now() < record.cooldownUntil) {
            return { restricted: true, record };
        }
        if (record.cooldownUntil > 0 && Date.now() >= record.cooldownUntil) {
            const lifted = Object.assign(Object.assign({}, record), { cooldownUntil: 0 });
            await UserStatusStore.save(persistence, userId, lifted);
            return { restricted: false, record: lifted };
        }
        return { restricted: false, record };
    }
}
exports.UserStatusStore = UserStatusStore;
