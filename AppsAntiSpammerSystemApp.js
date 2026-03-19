"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppsAntiSpammerSystemApp = void 0;
const App_1 = require("@rocket.chat/apps-engine/definition/App");
const rooms_1 = require("@rocket.chat/apps-engine/definition/rooms");
const ui_1 = require("@rocket.chat/apps-engine/definition/ui");
const metadata_1 = require("@rocket.chat/apps-engine/definition/metadata");
const BlockBuilder_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder");
const RestrictionManager_1 = require("./actions/RestrictionManager");
const MessageCache_1 = require("./cache/MessageCache");
const AntiSpamCommand_1 = require("./commands/AntiSpamCommand");
const SpamProcessor_1 = require("./core/SpamProcessor");
const UserStatusStore_1 = require("./persistence/UserStatusStore");
const Settings_1 = require("./settings/Settings");
const ActionIds_1 = require("./ui/ActionIds");
const DashboardModal_1 = require("./ui/DashboardModal");
class AppsAntiSpammerSystemApp extends App_1.App {
    constructor(info, logger, accessors) {
        super(info, logger, accessors);
        this.adminChannelName = 'antispam-admin';
        this.cache = new MessageCache_1.MessageCache();
        this.processor = new SpamProcessor_1.SpamProcessor(this.cache, 42 * 86400000, 300000, 3);
    }
    async extendConfiguration(configuration, environmentRead) {
        for (const setting of Settings_1.APP_SETTINGS) {
            await configuration.settings.provideSetting(setting);
        }
        await configuration.slashCommands.provideSlashCommand(new AntiSpamCommand_1.AntiSpamCommand(this.cache, this.getID()));
        configuration.ui.registerButton({
            actionId: ActionIds_1.ActionId.DASHBOARD_BUTTON,
            context: ui_1.UIActionButtonContext.ROOM_ACTION,
            labelI18n: 'Anti-Spam Dashboard',
            when: {
                hasOneRole: ['admin', 'moderator'],
            },
        });
    }
    async onEnable(environment, configurationModify) {
        await this.loadSettings(environment);
        return true;
    }
    async onSettingUpdated(setting, configurationModify, read, http) {
        await this.loadSettings(read.getEnvironmentReader());
    }
    async loadSettings(env) {
        const settings = env.getSettings();
        const windowDays = await settings.getValueById(Settings_1.AppSetting.MonitoringWindowDays);
        const slidingSec = await settings.getValueById(Settings_1.AppSetting.SlidingWindowSeconds);
        const threshold = await settings.getValueById(Settings_1.AppSetting.CrossChannelThreshold);
        this.adminChannelName = await settings.getValueById(Settings_1.AppSetting.AdminChannelName);
        this.processor.updateConfig(windowDays * 86400000, slidingSec * 1000, threshold);
    }
    async onInstall(context, read, http, persistence, modify) {
        const installer = context.user;
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) {
            return;
        }
        const existing = await read.getRoomReader().getByName(this.adminChannelName);
        if (!existing) {
            const roomBuilder = modify.getCreator().startRoom()
                .setDisplayName('Anti-Spam Admin')
                .setSlugifiedName(this.adminChannelName)
                .setType(rooms_1.RoomType.PRIVATE_GROUP)
                .setCreator(appUser)
                .setMembersToBeAddedByUsernames([installer.username]);
            await modify.getCreator().finish(roomBuilder);
        }
        await RestrictionManager_1.RestrictionManager.dmUser(read, modify, installer, `🛡️ **Anti-Spam System installed!**\n\n` +
            `Admin alerts will appear in \`#${this.adminChannelName}\`.\n` +
            `Use \`/antispam help\` for available commands.\n` +
            `Configure settings in *Admin → Apps → Anti-Spam*.`);
    }
    async checkPreMessageSentPrevent(message, read, http) {
        if (!message.text || message.room.type === rooms_1.RoomType.DIRECT_MESSAGE) {
            return false;
        }
        return this.processor.isNewUser(message);
    }
    async executePreMessageSentPrevent(message, read, http, persistence) {
        const { restricted } = await UserStatusStore_1.UserStatusStore.isRestricted(read, persistence, message.sender.id);
        return restricted;
    }
    async checkPostMessageSent(message, read, http) {
        if (!message.text || message.room.type === rooms_1.RoomType.DIRECT_MESSAGE) {
            return false;
        }
        return this.processor.isNewUser(message);
    }
    async executePostMessageSent(message, read, http, persistence, modify) {
        const result = await this.processor.analyzeMessage(message, read, persistence);
        if (result.escalated && result.record) {
            await RestrictionManager_1.RestrictionManager.applyAction(read, modify, message.sender, result.record, result.trigger, this.adminChannelName, this.getID());
        }
    }
    async [metadata_1.AppMethod.UIKIT_BLOCK_ACTION](context, read, http, persistence, modify) {
        const data = context.getInteractionData();
        const { actionId, value, user } = data;
        if (actionId === ActionIds_1.ActionId.VOUCH_USER && value) {
            const targetUser = await read.getUserReader().getById(value);
            if (targetUser) {
                await UserStatusStore_1.UserStatusStore.reset(persistence, targetUser.id, targetUser.username, user.username);
                this.cache.clearUser(targetUser.id);
                const updatedModal = await (0, DashboardModal_1.buildDashboardModal)(read, this.getID());
                return context.getInteractionResponder().updateModalViewResponse(updatedModal);
            }
        }
        if (actionId === ActionIds_1.ActionId.VIEW_STATUS && value) {
            const targetUser = await read.getUserReader().getById(value);
            if (targetUser) {
                const record = await UserStatusStore_1.UserStatusStore.get(read, targetUser.id);
                if (record) {
                    const blocks = new BlockBuilder_1.BlockBuilder(this.getID());
                    (0, DashboardModal_1.buildUserStatusBlocks)(blocks, record);
                    return context.getInteractionResponder().openModalViewResponse({
                        title: {
                            type: 'plain_text',
                            text: `Status: @${targetUser.username}`,
                        },
                        blocks: blocks.getBlocks(),
                        close: {
                            type: 'button',
                            text: { type: 'plain_text', text: 'Close' },
                            actionId: 'close-status',
                        },
                    });
                }
            }
        }
        return context.getInteractionResponder().successResponse();
    }
    async [metadata_1.AppMethod.UIKIT_ACTION_BUTTON](context, read, http, persistence, modify) {
        const data = context.getInteractionData();
        if (data.actionId === ActionIds_1.ActionId.DASHBOARD_BUTTON) {
            const triggerId = data.triggerId;
            if (triggerId) {
                const modal = await (0, DashboardModal_1.buildDashboardModal)(read, this.getID());
                await modify.getUiController().openSurfaceView(modal, { triggerId }, data.user);
            }
        }
        return context.getInteractionResponder().successResponse();
    }
}
exports.AppsAntiSpammerSystemApp = AppsAntiSpammerSystemApp;
