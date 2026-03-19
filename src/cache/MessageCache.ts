import { CachedMessage } from '../types';

export class MessageCache {
    private cache: Map<string, CachedMessage[]> = new Map();
    private readonly maxPerUser = 10;

    public add(userId: string, hash: number, roomId: string): void {
        const entries = this.cache.get(userId) || [];
        entries.push({ hash, roomId, timestamp: Date.now() });

        if (entries.length > this.maxPerUser) {
            entries.shift();
        }

        this.cache.set(userId, entries);
    }

    public hasExactDuplicate(userId: string, hash: number, windowMs: number): boolean {
        return this.getRecent(userId, windowMs).some((e) => e.hash === hash);
    }

    public crossChannelCount(userId: string, hash: number, currentRoomId: string, windowMs: number): number {
        const rooms = new Set<string>();

        for (const entry of this.getRecent(userId, windowMs)) {
            if (entry.hash === hash) {
                rooms.add(entry.roomId);
            }
        }

        rooms.add(currentRoomId);
        return rooms.size;
    }

    public clearUser(userId: string): void {
        this.cache.delete(userId);
    }

    private getRecent(userId: string, windowMs: number): CachedMessage[] {
        const entries = this.cache.get(userId);
        if (!entries) { return []; }

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
