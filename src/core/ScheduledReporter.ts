import { IHttp, IModify, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { FlagLogStore } from '../persistence/FlagLogStore';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { CHAOS_LABELS, ChaosLevel, DailyFlagSummary } from '../types';
import { AiConfig, AiService } from './AiService';

export class ScheduledReporter {
    public static async sendDailyReport(
        read: IRead,
        modify: IModify,
        http: IHttp,
        adminChannelName: string,
        aiConfig: AiConfig,
    ): Promise<void> {
        // Get the admin channel room
        const room = await read.getRoomReader().getByName(adminChannelName);
        if (!room) { return; }

        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) { return; }

        // Get data from last 24 hours
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const summaries = await FlagLogStore.getDailySummariesSince(read, since);
        const allUsers = await UserStatusStore.getAll(read);
        const flaggedUsers = allUsers.filter((u) => u.chaosLevel > ChaosLevel.Clean);

        const totalFlags = summaries.reduce((sum, s) => sum + s.flagCount, 0);

        const dateStr = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });

        // Build report text
        const reportLines: string[] = [
            `📋 **Daily Anti-Spam Report** — ${dateStr}`,
            '',
        ];

        if (totalFlags === 0 && flaggedUsers.length === 0) {
            reportLines.push(
                '✅ **All Clear** — No spam activity detected in the last 24 hours.',
                '',
                `• Flags today: 0`,
                `• Flagged users: 0`,
                `• Tracked users: ${allUsers.length}`,
            );
        } else {
            reportLines.push(
                `**Summary:**`,
                `• Flags in last 24h: ${totalFlags}`,
                `• Currently flagged users: ${flaggedUsers.length}`,
                `• Total tracked users: ${allUsers.length}`,
                '',
            );

            for (let level = ChaosLevel.Warning; level <= ChaosLevel.AdminReview; level++) {
                const usersAtLevel = flaggedUsers.filter((u) => u.chaosLevel === level);
                if (usersAtLevel.length > 0) {
                    const label = CHAOS_LABELS[level as ChaosLevel] || 'Unknown';
                    reportLines.push(`**${label}** (${usersAtLevel.length}):`);
                    for (const u of usersAtLevel) {
                        reportLines.push(`  • @${u.username} — ${u.totalFlags} total flags, ${u.flagsAtLevel || 0} at current level`);
                    }
                    reportLines.push('');
                }
            }

            if (summaries.length > 0) {
                reportLines.push('**Flagged Users (Last 24h):**');
                const toShow = summaries.slice(0, 15);
                for (const s of toShow) {
                    const triggerList = Object.entries(s.triggers).map(([k, v]) => `${k}:${v}`).join(', ');
                    reportLines.push(`  • @${s.username} — ${s.flagCount} flags (${triggerList}) in ${s.rooms.slice(0, 3).map((r) => `#${r}`).join(', ')}`);
                }
                if (summaries.length > 15) {
                    reportLines.push(`  _...and ${summaries.length - 15} more_`);
                }
                reportLines.push('');
            }

            // Aggregate actions across all summaries
            const actionTotals: Record<string, number> = {};
            for (const s of summaries) {
                for (const [action, count] of Object.entries(s.actions)) {
                    actionTotals[action] = (actionTotals[action] || 0) + count;
                }
            }

            reportLines.push('**Actions Taken:**');
            reportLines.push(`  • Warnings: ${actionTotals['warning'] || 0}`);
            reportLines.push(`  • Cooldowns: ${actionTotals['cooldown'] || 0}`);
            reportLines.push(`  • Restrictions: ${actionTotals['restricted'] || 0}`);
            reportLines.push(`  • Admin Reviews: ${actionTotals['admin-review'] || 0}`);
            reportLines.push('');
        }

        const reportText = reportLines.join('\n');

        // Build full message - add AI summary if configured
        let fullMessage = reportText;
        if (aiConfig.provider !== 'none' && aiConfig.apiKey) {
            const prompt = AiService.buildReportSummaryPrompt(reportText);
            const aiSummary = await AiService.query(http, aiConfig, prompt);
            fullMessage += '\n---\n🤖 **AI Analysis:**\n' + aiSummary;
        }

        // Send to admin channel
        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setText(fullMessage);
        await modify.getCreator().finish(msg);
    }

    public static shouldSendReport(reportTime: string): boolean {
        const [targetHour, targetMinute] = reportTime.split(':').map(Number);
        const now = new Date();
        return now.getHours() === targetHour && now.getMinutes() === targetMinute;
    }
}
