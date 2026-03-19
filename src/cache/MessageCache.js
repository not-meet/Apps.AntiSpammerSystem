"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageCache = void 0;
class MessageCache {
    constructor() {
        this.cache = new Map();
        this.maxPerUser = 10;
    }
    add(userId, hash, roomId) {
        const entries = this.cache.get(userId) || [];
        entries.push({ hash, roomId, timestamp: Date.now() });
        if (entries.length > this.maxPerUser) {
            entries.shift();
        }
        this.cache.set(userId, entries);
    }
    hasExactDuplicate(userId, hash, windowMs) {
        return this.getRecent(userId, windowMs).some((e) => e.hash === hash);
    }
    crossChannelCount(userId, hash, currentRoomId, windowMs) {
        const rooms = new Set();
        for (const entry of this.getRecent(userId, windowMs)) {
            if (entry.hash === hash) {
                rooms.add(entry.roomId);
            }
        }
        rooms.add(currentRoomId);
        return rooms.size;
    }
    clearUser(userId) {
        this.cache.delete(userId);
    }
    getRecent(userId, windowMs) {
        const entries = this.cache.get(userId);
        if (!entries) {
            return [];
        }
        const cutoff = Date.now() - windowMs;
        const recent = entries.filter((e) => e.timestamp >= cutoff);
        if (recent.length !== entries.length) {
            recent.length === 0
                ? this.cache.delete(userId)
                : this.cache.set(userId, recent);
        }
        return recent;
    }
}
exports.MessageCache = MessageCache;
