import {
    IAppAccessors,
    IAppInstallationContext,
    IConfigurationExtend,
    IConfigurationModify,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IMessage, IPostMessageSent, IPreMessageSentPrevent } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { RoomType } from '@rocket.chat/apps-engine/definition/rooms';
import { ISetting } from '@rocket.chat/apps-engine/definition/settings';
import { UIActionButtonContext } from '@rocket.chat/apps-engine/definition/ui';
import { IUIKitInteractionHandler } from '@rocket.chat/apps-engine/definition/uikit/IUIKitActionHandler';
import { IUIKitResponse } from '@rocket.chat/apps-engine/definition/uikit/IUIKitInteractionType';
import {
    UIKitActionButtonInteractionContext,
    UIKitBlockInteractionContext,
} from '@rocket.chat/apps-engine/definition/uikit/UIKitInteractionContext';
import { AppMethod } from '@rocket.chat/apps-engine/definition/metadata';
import { BlockBuilder } from '@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder';

import { MessageCache } from './src/cache/MessageCache';
import { AntiSpamCommand } from './src/commands/AntiSpamCommand';
import { AiConfig } from './src/core/AiService';
import { ScheduledReporter } from './src/core/ScheduledReporter';
import { SpamProcessor } from './src/core/SpamProcessor';
import { FlagLogStore } from './src/persistence/FlagLogStore';
import { UserStatusStore } from './src/persistence/UserStatusStore';
import { APP_SETTINGS, AppSetting } from './src/settings/Settings';
import { ActionId } from './src/ui/ActionIds';
import { buildDashboardModal, buildUserStatusBlocks } from './src/ui/DashboardModal';
import { RestrictionManager } from './src/actions/RestrictionManager';
import { ChaosLevel, FlagAction } from './src/types';

export class AppsAntiSpammerSystemApp extends App
    implements IPreMessageSentPrevent, IPostMessageSent, IUIKitInteractionHandler {

    private processor: SpamProcessor;
    private cache: MessageCache;
    private adminChannelName = 'antispam-admin';
    private scheduledReportEnabled = false;
    private scheduledReportTime = '18:00';
    private aiConfig: AiConfig = { provider: 'none', apiKey: '', model: '' };
    private lastReportDate = '';
    private lastCacheCleanup = 0;

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async initialize(
        configurationExtend: IConfigurationExtend,
        environmentRead: IEnvironmentRead,
    ): Promise<void> {
        this.cache = new MessageCache();
        this.processor = new SpamProcessor(
            this.cache,
            42 * 86_400_000,
            300_000,
            3,
        );
        await super.initialize(configurationExtend, environmentRead);
    }

    // ── Configuration ────────────────────────────────────────────────────

    protected async extendConfiguration(
        configuration: IConfigurationExtend,
        environmentRead: IEnvironmentRead,
    ): Promise<void> {
        for (const setting of APP_SETTINGS) {
            await configuration.settings.provideSetting(setting);
        }

        await configuration.slashCommands.provideSlashCommand(
            new AntiSpamCommand(this.cache, this.getID(), () => this.aiConfig),
        );

        configuration.ui.registerButton({
            actionId: ActionId.DASHBOARD_BUTTON,
            context: UIActionButtonContext.ROOM_ACTION,
            labelI18n: 'Anti-Spam Dashboard',
            when: {
                hasOneRole: ['admin', 'moderator'],
            },
        });
    }

    public async onEnable(
        environment: IEnvironmentRead,
        configurationModify: IConfigurationModify,
    ): Promise<boolean> {
        await this.loadSettings(environment);
        return true;
    }

    public async onSettingUpdated(
        setting: ISetting,
        configurationModify: IConfigurationModify,
        read: IRead,
        http: IHttp,
    ): Promise<void> {
        await this.loadSettings(read.getEnvironmentReader());
    }

    private async loadSettings(env: IEnvironmentRead): Promise<void> {
        const settings = env.getSettings();
        const windowDays = await settings.getValueById(AppSetting.MonitoringWindowDays) as number;
        const slidingSec = await settings.getValueById(AppSetting.SlidingWindowSeconds) as number;
        const threshold = await settings.getValueById(AppSetting.CrossChannelThreshold) as number;
        this.adminChannelName = await settings.getValueById(AppSetting.AdminChannelName) as string;
        this.scheduledReportEnabled = await settings.getValueById(AppSetting.ScheduledReportEnabled) as boolean;
        this.scheduledReportTime = await settings.getValueById(AppSetting.ScheduledReportTime) as string || '18:00';

        const aiProvider = await settings.getValueById(AppSetting.AiProvider) as string;
        const aiApiKey = await settings.getValueById(AppSetting.AiApiKey) as string;
        const aiModel = await settings.getValueById(AppSetting.AiModel) as string;
        this.aiConfig = {
            provider: (aiProvider || 'none') as AiConfig['provider'],
            apiKey: aiApiKey || '',
            model: aiModel || '',
        };

        this.processor.updateConfig(
            windowDays * 86_400_000,
            slidingSec * 1000,
            threshold,
        );
    }

    // ── Scheduled Report (piggybacks on message processing) ────────────

    private async tryScheduledReport(
        read: IRead,
        modify: IModify,
        http: IHttp,
    ): Promise<void> {
        if (!this.scheduledReportEnabled) { return; }
        if (!ScheduledReporter.shouldSendReport(this.scheduledReportTime)) { return; }

        const todayKey = new Date().toISOString().slice(0, 10);
        if (this.lastReportDate === todayKey) { return; }
        this.lastReportDate = todayKey;

        try {
            await ScheduledReporter.sendDailyReport(
                read, modify, http,
                this.adminChannelName, this.aiConfig,
            );
        } catch (err) {
            this.getLogger().error('Scheduled report failed:', err);
        }
    }

    // ── Install: Create admin channel ────────────────────────────────────

    public async onInstall(
        context: IAppInstallationContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<void> {
        const installer = context.user;
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) { return; }

        const existing = await read.getRoomReader().getByName(this.adminChannelName);
        if (!existing) {
            const roomBuilder = modify.getCreator().startRoom()
                .setDisplayName('Anti-Spam Admin')
                .setSlugifiedName(this.adminChannelName)
                .setType(RoomType.PRIVATE_GROUP)
                .setCreator(appUser)
                .setMembersToBeAddedByUsernames([installer.username]);
            await modify.getCreator().finish(roomBuilder);
        }

        await RestrictionManager.dmUser(
            read, modify, installer,
            `🛡️ **Anti-Spam System installed!**\n\n` +
            `Admin alerts will appear in \`#${this.adminChannelName}\`.\n` +
            `Use \`/antispam help\` for available commands.\n` +
            `Configure settings in *Admin → Apps → Anti-Spam*.`,
        );
    }

    // ── Gate 1 + 2: Block restricted new users ───────────────────────────

    public async checkPreMessageSentPrevent(
        message: IMessage,
        read: IRead,
        http: IHttp,
    ): Promise<boolean> {
        if (!message.text || message.room.type === RoomType.DIRECT_MESSAGE) {
            return false;
        }
        const fullUser = await read.getUserReader().getById(message.sender.id);
        if (!fullUser) { return false; }
        return this.processor.isNewUserFull(fullUser);
    }

    public async executePreMessageSentPrevent(
        message: IMessage,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
    ): Promise<boolean> {
        const { restricted } = await UserStatusStore.isRestricted(
            read, persistence, message.sender.id,
        );
        return restricted;
    }

    // ── Post-send: Analyze + escalate + notify + log ─────────────────────

    public async checkPostMessageSent(
        message: IMessage,
        read: IRead,
        http: IHttp,
    ): Promise<boolean> {
        if (!message.text || message.room.type === RoomType.DIRECT_MESSAGE) {
            return false;
        }
        const fullUser = await read.getUserReader().getById(message.sender.id);
        if (!fullUser) { return false; }
        return this.processor.isNewUserFull(fullUser);
    }

    public async executePostMessageSent(
        message: IMessage,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<void> {
        await this.tryScheduledReport(read, modify, http);

        const now = Date.now();
        if (now - this.lastCacheCleanup > 300_000) {
            this.cache.clearStale(600_000);
            this.lastCacheCleanup = now;
        }

        const result = await this.processor.analyzeMessage(message, read, persistence);

        if (result.flagged && result.record) {
            const chaosToAction: Record<number, FlagAction> = {
                [ChaosLevel.Clean]: 'warning',
                [ChaosLevel.Warning]: 'warning',
                [ChaosLevel.Cooldown]: 'cooldown',
                [ChaosLevel.Restricted]: 'restricted',
                [ChaosLevel.AdminReview]: 'admin-review',
            };

            let roomName = 'unknown';
            try {
                const room = await read.getRoomReader().getById(message.room.id);
                roomName = room?.slugifiedName || room?.displayName || message.room.id;
            } catch { /* fallback */ }

            await FlagLogStore.log(persistence, read, {
                userId: message.sender.id,
                username: message.sender.username,
                roomId: message.room.id,
                roomName,
                messageText: (message.text || '').substring(0, 200),
                trigger: result.trigger as any,
                chaosLevel: result.record.chaosLevel,
                timestamp: Date.now(),
                action: chaosToAction[result.record.chaosLevel] || 'warning',
            });

            if (result.levelChanged) {
                await RestrictionManager.applyAction(
                    read, modify, message.sender,
                    result.record, result.trigger, this.adminChannelName, this.getID(),
                );
            }
        }
    }

    // ── UI Kit Interactions ──────────────────────────────────────────────

    public async [AppMethod.UIKIT_BLOCK_ACTION](
        context: UIKitBlockInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<IUIKitResponse> {
        const data = context.getInteractionData();
        const { actionId, value, user } = data;

        if (actionId === ActionId.VOUCH_USER && value) {
            const targetUser = await read.getUserReader().getById(value);
            if (targetUser) {
                await UserStatusStore.reset(persistence, targetUser.id, targetUser.username, user.username);
                this.cache.clearUser(targetUser.id);

                const updatedModal = await buildDashboardModal(read, this.getID());
                return context.getInteractionResponder().updateModalViewResponse(updatedModal);
            }
        }

        if (actionId === ActionId.RESET_COOLDOWN && value) {
            const targetUser = await read.getUserReader().getById(value);
            if (targetUser) {
                await UserStatusStore.resetCooldown(read, persistence, targetUser.id);

                const updatedModal = await buildDashboardModal(read, this.getID());
                return context.getInteractionResponder().updateModalViewResponse(updatedModal);
            }
        }

        if (actionId === ActionId.VIEW_STATUS && value) {
            const targetUser = await read.getUserReader().getById(value);
            if (targetUser) {
                const record = await UserStatusStore.get(read, targetUser.id);
                if (record) {
                    const blocks = new BlockBuilder(this.getID());
                    buildUserStatusBlocks(blocks, record);

                    return context.getInteractionResponder().openModalViewResponse({
                        title: {
                            type: 'plain_text' as any,
                            text: `Status: @${targetUser.username}`,
                        },
                        blocks: blocks.getBlocks(),
                        close: {
                            type: 'button' as any,
                            text: { type: 'plain_text' as any, text: 'Close' },
                            actionId: 'close-status',
                        },
                    });
                }
            }
        }

        return context.getInteractionResponder().successResponse();
    }

    public async [AppMethod.UIKIT_ACTION_BUTTON](
        context: UIKitActionButtonInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<IUIKitResponse> {
        const data = context.getInteractionData();

        if (data.actionId === ActionId.DASHBOARD_BUTTON) {
            const triggerId = data.triggerId;
            if (triggerId) {
                const modal = await buildDashboardModal(read, this.getID());
                await modify.getUiController().openSurfaceView(
                    modal,
                    { triggerId },
                    data.user,
                );
            }
        }

        return context.getInteractionResponder().successResponse();
    }
}
