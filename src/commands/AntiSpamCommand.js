"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntiSpamCommand = void 0;
const UserStatusStore_1 = require("../persistence/UserStatusStore");
const types_1 = require("../types");
const DashboardModal_1 = require("../ui/DashboardModal");
class AntiSpamCommand {
    constructor(cache, appId) {
        this.cache = cache;
        this.appId = appId;
        this.command = 'antispam';
        this.i18nParamsExample = 'antispam_params';
        this.i18nDescription = 'antispam_description';
        this.providesPreview = false;
    }
    async executor(context, read, modify, http, persis) {
        var _a;
        const args = context.getArguments();
        const sender = context.getSender();
        const room = context.getRoom();
        const subcommand = (_a = args[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
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
    async handleStatus(username, read, modify, sender, room) {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam status <username>`');
        }
        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }
        const record = await UserStatusStore_1.UserStatusStore.get(read, user.id);
        if (!record) {
            return this.reply(read, modify, sender, room, `✅ \`${username}\` has no spam record (clean).`);
        }
        const label = types_1.CHAOS_LABELS[record.chaosLevel] || 'Unknown';
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
    async handleVouch(username, read, modify, persis, sender, room) {
        if (!username) {
            return this.reply(read, modify, sender, room, '❌ Usage: `/antispam vouch <username>`');
        }
        const user = await read.getUserReader().getByUsername(username);
        if (!user) {
            return this.reply(read, modify, sender, room, `❌ User \`${username}\` not found.`);
        }
        await UserStatusStore_1.UserStatusStore.reset(persis, user.id, user.username, sender.username);
        this.cache.clearUser(user.id);
        return this.reply(read, modify, sender, room, `✅ @${username} has been vouched by @${sender.username}. Chaos level reset to 0.`);
    }
    async handleDashboard(context, read, modify, sender) {
        const triggerId = context.getTriggerId();
        if (!triggerId) {
            return this.reply(read, modify, sender, context.getRoom(), '❌ Could not open dashboard. Try again.');
        }
        const modal = await (0, DashboardModal_1.buildDashboardModal)(read, this.appId);
        await modify.getUiController().openSurfaceView(modal, { triggerId }, sender);
    }
    async sendHelp(read, modify, sender, room) {
        return this.reply(read, modify, sender, room, [
            '🛡️ **Anti-Spam Commands**',
            '`/antispam status <username>` — View spam status for a user',
            '`/antispam vouch <username>` — Reset chaos level (admin override)',
            '`/antispam dashboard` — Open flagged users dashboard',
            '`/antispam help` — Show this help message',
        ].join('\n'));
    }
    async reply(read, modify, sender, room, text) {
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) {
            return;
        }
        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setText(text)
            .getMessage();
        await modify.getNotifier().notifyUser(sender, msg);
    }
}
exports.AntiSpamCommand = AntiSpamCommand;
