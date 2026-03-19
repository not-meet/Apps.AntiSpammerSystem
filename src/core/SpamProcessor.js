"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpamProcessor = void 0;
const UserStatusStore_1 = require("../persistence/UserStatusStore");
class SpamProcessor {
    constructor(cache, monitoringWindowMs, slidingWindowMs, crossChannelThreshold) {
        this.cache = cache;
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
    }
    isNewUser(message) {
        const createdAt = message.sender.createdAt;
        if (!createdAt) {
            return false;
        }
        const age = Date.now() - new Date(createdAt).getTime();
        return age < this.monitoringWindowMs;
    }
    async analyzeMessage(message, read, persistence) {
        const hash = this.hashText(message.text || '');
        const userId = message.sender.id;
        const roomId = message.room.id;
        const username = message.sender.username;
        if (this.cache.hasExactDuplicate(userId, hash, this.slidingWindowMs)) {
            const record = await UserStatusStore_1.UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, hash, roomId);
            return { escalated: true, trigger: 'duplicate', record };
        }
        const channels = this.cache.crossChannelCount(userId, hash, roomId, this.slidingWindowMs);
        if (channels >= this.crossChannelThreshold) {
            const record = await UserStatusStore_1.UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, hash, roomId);
            return { escalated: true, trigger: 'cross-channel', record };
        }
        this.cache.add(userId, hash, roomId);
        return { escalated: false, trigger: 'none', record: null };
    }
    updateConfig(monitoringWindowMs, slidingWindowMs, crossChannelThreshold) {
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
    }
    hashText(text) {
        const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
        let h = 5381;
        for (let i = 0; i < normalized.length; i++) {
            h = ((h << 5) + h) + normalized.charCodeAt(i);
            h = h & h;
        }
        return h;
    }
}
exports.SpamProcessor = SpamProcessor;
