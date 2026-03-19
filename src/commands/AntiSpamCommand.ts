import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { ISlashCommand, SlashCommandContext } from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { MessageCache } from '../cache/MessageCache';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { CHAOS_LABELS } from '../types';
import { buildDashboardModal } from '../ui/DashboardModal';

export class AntiSpamCommand implements ISlashCommand {
    public command = 'antispam';
    public i18nParamsExample = 'antispam_params';
    public i18nDescription = 'antispam_description';
    public providesPreview = false;

    constructor(
        private readonly cache: MessageCache,
        private readonly appId: string,
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
        const cooldown = record.cooldownUntil > Date.now()
            ? `expires in ${Math.ceil((record.cooldownUntil - Date.now()) / 1000)}s`
            : 'none';

        return this.reply(read, modify, sender, room, [
            `📊 **Spam Status for @${username}**`,
            `**Chaos Level:** ${record.chaosLevel} — ${label}`,
            `**Cooldown:** ${cooldown}`,
            `**Total Flags:** ${record.totalFlags}`,
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

    private async sendHelp(read: IRead, modify: IModify, sender: IUser, room: IRoom): Promise<void> {
        return this.reply(read, modify, sender, room, [
            '🛡️ **Anti-Spam Commands**',
            '`/antispam status <username>` — View spam status for a user',
            '`/antispam vouch <username>` — Reset chaos level (admin override)',
            '`/antispam dashboard` — Open flagged users dashboard',
            '`/antispam help` — Show this help message',
        ].join('\n'));
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
