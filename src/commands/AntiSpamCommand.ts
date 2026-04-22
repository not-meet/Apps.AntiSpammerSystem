import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { ISlashCommand, SlashCommandContext } from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { MessageCache } from '../cache/MessageCache';
import { AiConfig, AiService } from '../core/AiService';
import { FlagLogStore } from '../persistence/FlagLogStore';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { CHAOS_LABELS, ChaosLevel } from '../types';
import { buildDashboardModal } from '../ui/DashboardModal';

export class AntiSpamCommand implements ISlashCommand {
    public command = 'antispam';
    public i18nParamsExample = 'antispam_params';
    public i18nDescription = 'antispam_description';
    public providesPreview = false;

    constructor(
        private readonly cache: MessageCache,
        private readonly appId: string,
        private readonly aiConfigProvider: () => AiConfig,
    ) {}

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persis: IPersistence,
    ): Promise<void> {
        const args = context.getArguments();
        const sender = context.getSender();
        const room = context.getRoom();
        const subcommand = args[0]?.toLowerCase();

        switch (subcommand) {
            case 'status':
                await this.handleStatus(args[1], read, modify, sender, room);
                break;
            case 'vouch':
                await this.handleVouch(args[1], read, modify, persis, sender, room);
                break;
            case 'dashboard':
                await this.handleDashboard(context, read, modify, sender);
                break;
            case 'lookup':
                await this.handleLookup(args[1], read, modify, sender, room);
                break;
            case 'reset-cooldown':
                await this.handleResetCooldown(args[1], read, modify, persis, sender, room);
                break;
            case 'ai':
                await this.handleAi(args.slice(1), read, modify, http, sender, room);
                break;
            default:
                await this.sendHelp(read, modify, sender, room);
                break;
        }
    }

    private async handleStatus(
        username: string | undefined,
        read: IRead,
        modify: IModify,
        sender: IUser,
        room: IRoom,
    ): Promise<void> {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam status <username>`');
        }

        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }

        const record = await UserStatusStore.get(read, user.id);
        if (!record) {
            return this.reply(read, modify, sender, room, `✅ \`${username}\` has no spam record (clean).`);
        }

        const label = CHAOS_LABELS[record.chaosLevel] || 'Unknown';
        const cooldown = record.chaosLevel === ChaosLevel.AdminReview
            ? '🔒 Blocked (pending review)'
            : record.cooldownUntil > Date.now()
                ? `expires in ${this.formatDuration(record.cooldownUntil - Date.now())}`
                : 'none';

        return this.reply(read, modify, sender, room, [
            `📊 **Spam Status for @${username}**`,
            `**Chaos Level:** ${record.chaosLevel} — ${label}`,
            `**Cooldown:** ${cooldown}`,
            `**Total Flags:** ${record.totalFlags}`,
            `**Flags at current level:** ${record.flagsAtLevel || 0}`,
            record.vouchedBy ? `**Vouched by:** @${record.vouchedBy}` : '',
        ].filter(Boolean).join('\n'));
    }

    private async handleVouch(
        username: string | undefined,
        read: IRead,
        modify: IModify,
        persis: IPersistence,
        sender: IUser,
        room: IRoom,
    ): Promise<void> {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam vouch <username>`');
        }

        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }

        await UserStatusStore.reset(persis, user.id, user.username, sender.username);
        this.cache.clearUser(user.id);
        return this.reply(read, modify, sender, room,
            `✅ @${username} has been vouched by @${sender.username}. Chaos level reset to 0.`,
        );
    }

    private async handleDashboard(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        sender: IUser,
    ): Promise<void> {
        const triggerId = context.getTriggerId();
        if (!triggerId) {
            return this.reply(read, modify, sender, context.getRoom(),
                '❌ Could not open dashboard. Try again.',
            );
        }

        const modal = await buildDashboardModal(read, this.appId);
        await modify.getUiController().openSurfaceView(
            modal,
            { triggerId },
            sender,
        );
    }

    private async handleLookup(
        username: string | undefined,
        read: IRead,
        modify: IModify,
        sender: IUser,
        room: IRoom,
    ): Promise<void> {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam lookup <username>`');
        }

        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }

        const flags = await FlagLogStore.getByUser(read, user.id);
        if (flags.length === 0) {
            return this.reply(read, modify, sender, room, `✅ No flag history found for @${username}.`);
        }

        const sorted = flags.sort((a, b) => b.timestamp - a.timestamp);
        const lines: string[] = [
            `🔍 **Flag History for @${username}** (${sorted.length} events)`,
            '',
        ];

        for (const flag of sorted.slice(0, 20)) {
            const date = new Date(flag.timestamp);
            const ts = date.toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
            lines.push(
                `• \`${ts}\` — **#${flag.roomName}** — ${flag.trigger} → ${flag.action}`,
            );
            if (flag.messageText) {
                const preview = flag.messageText.length > 80
                    ? flag.messageText.substring(0, 80) + '...'
                    : flag.messageText;
                lines.push(`  _"${preview}"_`);
            }
        }

        if (sorted.length > 20) {
            lines.push(`\n_...and ${sorted.length - 20} older events_`);
        }

        return this.reply(read, modify, sender, room, lines.join('\n'));
    }

    private async handleResetCooldown(
        username: string | undefined,
        read: IRead,
        modify: IModify,
        persis: IPersistence,
        sender: IUser,
        room: IRoom,
    ): Promise<void> {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam reset-cooldown <username>`');
        }

        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }

        const record = await UserStatusStore.get(read, user.id);
        if (!record || record.cooldownUntil === 0) {
            return this.reply(read, modify, sender, room,
                `ℹ️ @${username} has no active cooldown.`,
            );
        }

        await UserStatusStore.resetCooldown(read, persis, user.id);
        return this.reply(read, modify, sender, room,
            `✅ Cooldown reset for @${username}. Chaos level remains at ${record.chaosLevel} (${CHAOS_LABELS[record.chaosLevel]}).`,
        );
    }

    private async handleAi(
        args: string[],
        read: IRead,
        modify: IModify,
        http: IHttp,
        sender: IUser,
        room: IRoom,
    ): Promise<void> {
        const aiConfig = this.aiConfigProvider();
        if (aiConfig.provider === 'none' || !aiConfig.apiKey) {
            return this.reply(read, modify, sender, room,
                '❌ AI is not configured. Set an AI provider and API key in App Settings.',
            );
        }

        const subcommand = args[0]?.toLowerCase();

        switch (subcommand) {
            case 'summary': {
                const allUsers = await UserStatusStore.getAll(read);
                const flagged = allUsers.filter((u) => u.chaosLevel > ChaosLevel.Clean);
                const totalFlagsSum = allUsers.reduce((sum, u) => sum + (u.totalFlags || 0), 0);

                const reportLines = [
                    `Total flag events across all users: ${totalFlagsSum}`,
                    `Currently flagged users: ${flagged.length}`,
                    `Total tracked users: ${allUsers.length}`,
                    '',
                ];
                for (const u of flagged) {
                    const lvlLabel = CHAOS_LABELS[u.chaosLevel] || 'Unknown';
                    reportLines.push(`@${u.username}: level=${u.chaosLevel} (${lvlLabel}), totalFlags=${u.totalFlags}, flagsAtCurrentLevel=${u.flagsAtLevel || 0}`);
                }

                const prompt = AiService.buildReportSummaryPrompt(reportLines.join('\n'));
                const result = await AiService.query(http, aiConfig, prompt);
                return this.reply(read, modify, sender, room,
                    `🤖 **AI Summary:**\n${result}`,
                );
            }
            case 'analyze': {
                const username = args[1];
                if (!username) {
                    return this.reply(read, modify, sender, room,
                        '❌ Usage: `/antispam ai analyze <username>`',
                    );
                }

                const user = await read.getUserReader().getByUsername(username);
                if (!user) {
                    return this.reply(read, modify, sender, room,
                        `❌ User \`${username}\` not found.`,
                    );
                }

                const flags = await FlagLogStore.getByUser(read, user.id);
                const record = await UserStatusStore.get(read, user.id);

                const flagDetails = flags.map((f) => {
                    const ts = new Date(f.timestamp).toISOString();
                    return `${ts} | #${f.roomName} | ${f.trigger} | ${f.action} | "${f.messageText?.substring(0, 100) || ''}"`;
                }).join('\n');

                const details = [
                    `Chaos Level: ${record?.chaosLevel ?? 0}`,
                    `Total Flags: ${record?.totalFlags ?? 0}`,
                    `Vouched By: ${record?.vouchedBy || 'N/A'}`,
                    '',
                    'Flag Log:',
                    flagDetails || 'No flags recorded.',
                ].join('\n');

                const prompt = AiService.buildUserAnalysisPrompt(username, details);
                const result = await AiService.query(http, aiConfig, prompt);
                return this.reply(read, modify, sender, room,
                    `🤖 **AI Analysis of @${username}:**\n${result}`,
                );
            }
            case 'chaos': {
                const levelStr = args[1];
                const level = parseInt(levelStr, 10);
                if (isNaN(level) || level < 0 || level > 4) {
                    return this.reply(read, modify, sender, room,
                        '❌ Usage: `/antispam ai chaos <level>` (0-4)',
                    );
                }

                const allUsers = await UserStatusStore.getAll(read);
                const atLevel = allUsers.filter((u) => u.chaosLevel === level);

                if (atLevel.length === 0) {
                    return this.reply(read, modify, sender, room,
                        `ℹ️ No users at chaos level ${level} (${CHAOS_LABELS[level as ChaosLevel]}).`,
                    );
                }

                const usersList = atLevel.map((u) =>
                    `@${u.username}: flags=${u.totalFlags}, vouched=${u.vouchedBy || 'no'}`,
                ).join('\n');

                const prompt = AiService.buildChaosLevelQueryPrompt(level, usersList);
                const result = await AiService.query(http, aiConfig, prompt);
                return this.reply(read, modify, sender, room,
                    `🤖 **AI: Users at Chaos Level ${level} (${CHAOS_LABELS[level as ChaosLevel]}):**\n${result}`,
                );
            }
            default:
                return this.reply(read, modify, sender, room, [
                    '🤖 **AI Commands:**',
                    '`/antispam ai summary` — AI summary of all spam activity',
                    '`/antispam ai analyze <username>` — AI analysis of a specific user',
                    '`/antispam ai chaos <level>` — AI summary of users at a chaos level (0-4)',
                ].join('\n'));
        }
    }

    private async sendHelp(read: IRead, modify: IModify, sender: IUser, room: IRoom): Promise<void> {
        return this.reply(read, modify, sender, room, [
            '🛡️ **Anti-Spam Commands**',
            '`/antispam status <username>` — View spam status for a user',
            '`/antispam vouch <username>` — Reset chaos level (admin override)',
            '`/antispam lookup <username>` — View flagged messages with timestamps & channels',
            '`/antispam reset-cooldown <username>` — Reset cooldown only (keep chaos level)',
            '`/antispam dashboard` — Open flagged users dashboard',
            '`/antispam ai` — AI-powered analysis commands',
            '`/antispam help` — Show this help message',
        ].join('\n'));
    }

    private formatDuration(ms: number): string {
        const totalSec = Math.ceil(ms / 1000);
        if (totalSec < 60) { return `${totalSec}s`; }
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        if (min < 60) { return sec > 0 ? `${min}m ${sec}s` : `${min}m`; }
        const hr = Math.floor(min / 60);
        const remMin = min % 60;
        return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
    }

    private async reply(read: IRead, modify: IModify, sender: IUser, room: IRoom, text: string): Promise<void> {
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) { return; }

        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setText(text)
            .getMessage();

        await modify.getNotifier().notifyUser(sender, msg);
    }
}
