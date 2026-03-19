import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IMessage } from '@rocket.chat/apps-engine/definition/messages';
import { MessageCache } from '../cache/MessageCache';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { UserChaosRecord } from '../types';

export interface AnalysisResult {
    escalated: boolean;
    trigger: string;
    record: UserChaosRecord | null;
}

export class SpamProcessor {
    private monitoringWindowMs: number;
    private slidingWindowMs: number;
    private crossChannelThreshold: number;

    constructor(
        private readonly cache: MessageCache,
        monitoringWindowMs: number,
        slidingWindowMs: number,
        crossChannelThreshold: number,
    ) {
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
    }

    public isNewUser(message: IMessage): boolean {
        const createdAt = message.sender.createdAt;
        if (!createdAt) { return false; }
        const age = Date.now() - new Date(createdAt).getTime();
        return age < this.monitoringWindowMs;
    }

    public async analyzeMessage(
        message: IMessage,
        read: IRead,
        persistence: IPersistence,
    ): Promise<AnalysisResult> {
        const hash = this.hashText(message.text || '');
        const userId = message.sender.id;
        const roomId = message.room.id;

        const username = message.sender.username;

        // Gate 3: Exact duplicate in recent history
        if (this.cache.hasExactDuplicate(userId, hash, this.slidingWindowMs)) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, hash, roomId);
            return { escalated: true, trigger: 'duplicate', record };
        }

        // Gate 4: Cross-channel spam
        const channels = this.cache.crossChannelCount(userId, hash, roomId, this.slidingWindowMs);
        if (channels >= this.crossChannelThreshold) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, hash, roomId);
            return { escalated: true, trigger: 'cross-channel', record };
        }

        // Clean — update cache
        this.cache.add(userId, hash, roomId);
        return { escalated: false, trigger: 'none', record: null };
    }

    public updateConfig(
        monitoringWindowMs: number,
        slidingWindowMs: number,
        crossChannelThreshold: number,
    ): void {
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
    }

    private hashText(text: string): number {
        const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
        let h = 5381;
        for (let i = 0; i < normalized.length; i++) {
            h = ((h << 5) + h) + normalized.charCodeAt(i);
            h = h & h;
        }
        return h;
    }
}
