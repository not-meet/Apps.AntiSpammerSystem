import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import {
    RocketChatAssociationModel,
    RocketChatAssociationRecord,
} from '@rocket.chat/apps-engine/definition/metadata';
import { DailyFlagSummary, FlagLogEntry } from '../types';

const MAX_RECENT_EVENTS = 25;
const MAX_ROOMS_PER_SUMMARY = 20;

export class FlagLogStore {
    private static dayKey(timestamp: number): string {
        return new Date(timestamp).toISOString().slice(0, 10);
    }

    private static dailySummaryAssocs(userId: string, day: string): RocketChatAssociationRecord[] {
        return [
            new RocketChatAssociationRecord(RocketChatAssociationModel.USER, userId),
            new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `antispam-day:${day}`),
        ];
    }

    private static dailyScopeAssoc(day: string): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `antispam-day:${day}`);
    }

    private static recentEventsAssocs(userId: string): RocketChatAssociationRecord[] {
        return [
            new RocketChatAssociationRecord(RocketChatAssociationModel.USER, userId),
            new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'antispam-recent-flags'),
        ];
    }

    private static recentEventsScopeAssoc(): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'antispam-recent-flags');
    }

    public static async log(
        persistence: IPersistence,
        read: IRead,
        entry: FlagLogEntry,
    ): Promise<void> {
        const day = FlagLogStore.dayKey(entry.timestamp);

        // 1. Upsert the daily summary for this user+day
        const summaryAssocs = FlagLogStore.dailySummaryAssocs(entry.userId, day);
        const existingSummaries = await read.getPersistenceReader().readByAssociations(summaryAssocs);
        const existing = existingSummaries.length ? existingSummaries[0] as DailyFlagSummary : null;

        const summary: DailyFlagSummary = existing
            ? {
                ...existing,
                flagCount: existing.flagCount + 1,
                triggers: { ...existing.triggers, [entry.trigger]: (existing.triggers[entry.trigger] || 0) + 1 },
                actions: { ...existing.actions, [entry.action]: (existing.actions[entry.action] || 0) + 1 },
                rooms: existing.rooms.includes(entry.roomName)
                    ? existing.rooms
                    : existing.rooms.length < MAX_ROOMS_PER_SUMMARY
                        ? [...existing.rooms, entry.roomName]
                        : existing.rooms,
            }
            : {
                userId: entry.userId,
                username: entry.username,
                date: day,
                flagCount: 1,
                triggers: { [entry.trigger]: 1 },
                actions: { [entry.action]: 1 },
                rooms: [entry.roomName],
            };

        await persistence.updateByAssociations(summaryAssocs, summary, true);

        // 2. Upsert the recent events list for this user (cap at 25)
        const recentAssocs = FlagLogStore.recentEventsAssocs(entry.userId);
        const existingRecent = await read.getPersistenceReader().readByAssociations(recentAssocs);
        const recentDoc = existingRecent.length
            ? existingRecent[0] as { entries: FlagLogEntry[] }
            : { entries: [] };

        recentDoc.entries.push(entry);
        while (recentDoc.entries.length > MAX_RECENT_EVENTS) {
            recentDoc.entries.shift();
        }

        await persistence.updateByAssociations(recentAssocs, recentDoc, true);
    }

    public static async getByUser(read: IRead, userId: string): Promise<FlagLogEntry[]> {
        const records = await read.getPersistenceReader().readByAssociations(
            FlagLogStore.recentEventsAssocs(userId),
        );
        if (!records.length) { return []; }
        const doc = records[0] as { entries: FlagLogEntry[] };
        return (doc.entries || []).filter((r) => r.trigger !== undefined);
    }

    public static async getDailySummariesSince(
        read: IRead,
        sinceTimestamp: number,
    ): Promise<DailyFlagSummary[]> {
        const startDay = new Date(sinceTimestamp);
        startDay.setUTCHours(0, 0, 0, 0);
        const today = new Date();
        today.setUTCHours(23, 59, 59, 999);

        const summaries: DailyFlagSummary[] = [];
        const cursor = new Date(startDay);

        while (cursor <= today) {
            const day = cursor.toISOString().slice(0, 10);
            const daySummaries = await FlagLogStore.getDailySummariesForDay(read, day);
            summaries.push(...daySummaries);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        return summaries;
    }

    public static async getDailySummariesForDay(
        read: IRead,
        date: string,
    ): Promise<DailyFlagSummary[]> {
        const records = await read.getPersistenceReader().readByAssociation(
            FlagLogStore.dailyScopeAssoc(date),
        );
        return (records as DailyFlagSummary[]).filter((r) => r.flagCount !== undefined);
    }

    public static async getAllRecentEvents(read: IRead): Promise<FlagLogEntry[]> {
        const records = await read.getPersistenceReader().readByAssociation(
            FlagLogStore.recentEventsScopeAssoc(),
        );
        const allEntries: FlagLogEntry[] = [];
        for (const doc of records) {
            const typed = doc as { entries: FlagLogEntry[] };
            if (typed.entries) {
                allEntries.push(...typed.entries.filter((r) => r.trigger !== undefined));
            }
        }
        return allEntries;
    }
}
