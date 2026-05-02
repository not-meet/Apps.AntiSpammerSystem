import { createHash } from 'crypto';
import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IMessage } from '@rocket.chat/apps-engine/definition/messages';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { MessageCache } from '../cache/MessageCache';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { UserChaosRecord } from '../types';

export interface AnalysisResult {
    flagged: boolean;
    levelChanged: boolean;
    trigger: string;
    record: UserChaosRecord | null;
}

export class SpamProcessor {
    private monitoringWindowMs: number;
    private slidingWindowMs: number;
    private crossChannelThreshold: number;
    private rateShortBurst: number;
    private rateSustained: number;

    constructor(
        private readonly cache: MessageCache,
        monitoringWindowMs: number,
        slidingWindowMs: number,
        crossChannelThreshold: number,
        rateShortBurst: number = 5,
        rateSustained: number = 12,
    ) {
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
        this.rateShortBurst = rateShortBurst;
        this.rateSustained = rateSustained;
    }

    public isNewUserFull(user: IUser): boolean {
        const createdAt = user.createdAt;
        if (!createdAt) { return false; }
        const age = Date.now() - new Date(createdAt).getTime();
        return age < this.monitoringWindowMs;
    }

    public async analyzeMessage(
        message: IMessage,
        read: IRead,
        persistence: IPersistence,
    ): Promise<AnalysisResult> {
        const text = message.text || '';
        const normalized = this.normalize(text);
        const userId = message.sender.id;
        const roomId = message.room.id;
        const username = message.sender.username;
        const messageId = message.id;
        const { hasUrl, domains } = this.extractUrlInfo(text);

        this.cache.trackMessage(userId);

        // Edit-awareness: if this messageId already exists in cache, it's an edit — update, don't escalate
        if (messageId && this.cache.isEditedMessage(userId, messageId)) {
            const normalizedHash = this.hashText(normalized);
            this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
            return { flagged: false, levelChanged: false, trigger: 'edit', record: null };
        }

        const existing = await UserStatusStore.get(read, userId);
        const prevLevel = existing?.chaosLevel ?? 0;

        // Gate 3: Exact duplicate in recent history (use normalized hash)
        const normalizedHash = this.hashText(normalized);
        if (this.cache.hasExactDuplicate(userId, normalizedHash, this.slidingWindowMs)) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
            return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'duplicate', record };
        }

        // Gate 3.5: Fuzzy/polymorphic duplicate across channels
        if (normalized.length >= 10) {
            const tokenCount = normalized.split(' ').filter((t) => t.length >= 3).length;
            const simThreshold = tokenCount < 5 ? 0.85 : tokenCount < 8 ? 0.8 : 0.75;
            const fuzzyChannels = this.cache.getFuzzyChannels(
                userId,
                normalized,
                roomId,
                this.slidingWindowMs,
                (a: string, b: string) => this.cosineSim(this.tokenize(a), this.tokenize(b)),
                simThreshold,
            );
            if (fuzzyChannels >= this.crossChannelThreshold) {
                const record = await UserStatusStore.escalate(read, persistence, userId, username);
                this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
                return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'polymorphic-spam', record };
            }
        }

        // Gate 4: Cross-channel exact hash
        const channels = this.cache.crossChannelCount(userId, normalizedHash, roomId, this.slidingWindowMs);
        if (channels >= this.crossChannelThreshold) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
            return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'cross-channel', record };
        }

        // Gate 5: Message rate flood (configurable thresholds)
        const rate30s = this.cache.getMessageRate(userId, 30_000);
        const rate2m = this.cache.getMessageRate(userId, 120_000);
        if (rate30s >= this.rateShortBurst || rate2m >= this.rateSustained) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
            return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'rate-flood', record };
        }

        // Gate 6: Rapid room spread (≥3 distinct rooms in 2 min)
        const roomSpread = this.cache.getDistinctRooms(userId, 120_000);
        if (roomSpread >= this.crossChannelThreshold && rate2m >= this.crossChannelThreshold) {
            const record = await UserStatusStore.escalate(read, persistence, userId, username);
            this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
            return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'room-spread', record };
        }

        // Gate 7: URL spam (≥3 URL-bearing messages in 2 min across rooms)
        if (hasUrl) {
            const urlCount = this.cache.getUrlMessageCount(userId, 120_000);
            if (urlCount >= 3 && roomSpread >= 2) {
                const record = await UserStatusStore.escalate(read, persistence, userId, username);
                this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
                return { flagged: true, levelChanged: record.chaosLevel > prevLevel, trigger: 'url-spam', record };
            }
        }

        // Clean — update cache
        this.cache.add(userId, normalizedHash, roomId, normalized, hasUrl, domains, messageId);
        return { flagged: false, levelChanged: false, trigger: 'none', record: null };
    }

    public updateConfig(
        monitoringWindowMs: number,
        slidingWindowMs: number,
        crossChannelThreshold: number,
        rateShortBurst: number,
        rateSustained: number,
    ): void {
        this.monitoringWindowMs = monitoringWindowMs;
        this.slidingWindowMs = slidingWindowMs;
        this.crossChannelThreshold = crossChannelThreshold;
        this.rateShortBurst = rateShortBurst;
        this.rateSustained = rateSustained;
    }

    /**
     * Strips invisible chars, URLs, punctuation, lowercases.
     */
    private normalize(text: string): string {
        return text
            .toLowerCase()
            .replace(/[\u200B-\u200F\u2060-\u206F]/g, '')   // invisible unicode
            .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')           // emojis
            .replace(/https?:\/\/\S+/g, '')                   // URLs
            .replace(/[.,!?;:()\-#@]/g, '')                   // punctuation
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Word frequency map, ignoring tokens shorter than 3 chars.
     */
    private tokenize(text: string): Map<string, number> {
        const freq = new Map<string, number>();
        for (const token of text.split(' ')) {
            if (token.length >= 3) {
                freq.set(token, (freq.get(token) ?? 0) + 1);
            }
        }
        return freq;
    }

    /**
     * Cosine similarity between two token frequency maps.
     * Returns 0.0–1.0. Values above 0.7 indicate likely same message.
     */
    private cosineSim(a: Map<string, number>, b: Map<string, number>): number {
        if (a.size === 0 || b.size === 0) { return 0; }
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (const [k, v] of a) {
            dot += v * (b.get(k) ?? 0);
            normA += v * v;
        }
        for (const [, v] of b) {
            normB += v * v;
        }
        if (normA === 0 || normB === 0) { return 0; }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private extractUrlInfo(text: string): { hasUrl: boolean; domains: string[] } {
        const urlRegex = /https?:\/\/([^\/\s]+)/g;
        const domains: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = urlRegex.exec(text)) !== null) {
            domains.push(match[1].toLowerCase());
        }
        return { hasUrl: domains.length > 0, domains };
    }

    private hashText(text: string): string {
        const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
        return createHash('sha256').update(normalized).digest('hex');
    }
}
