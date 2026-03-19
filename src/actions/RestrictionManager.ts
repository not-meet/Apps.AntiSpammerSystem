import { IModify, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { RoomType } from '@rocket.chat/apps-engine/definition/rooms';
import { BlockBuilder } from '@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder';
import { ButtonStyle } from '@rocket.chat/apps-engine/definition/uikit/blocks/Elements';
import { ChaosLevel, CHAOS_LABELS, UserChaosRecord } from '../types';
import { ActionId } from '../ui/ActionIds';

export class RestrictionManager {
    public static async dmUser(
        read: IRead,
        modify: IModify,
        targetUser: IUser,
        text: string,
    ): Promise<void> {
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) { return; }

        let room = await read.getRoomReader().getDirectByUsernames([
            appUser.username,
            targetUser.username,
        ]) as any;

        if (!room) {
            const roomBuilder = modify.getCreator().startRoom()
                .setType(RoomType.DIRECT_MESSAGE)
                .setCreator(appUser)
                .setMembersToBeAddedByUsernames([appUser.username, targetUser.username]);
            const roomId = await modify.getCreator().finish(roomBuilder);
            room = await read.getRoomReader().getById(roomId);
        }

        if (!room) { return; }

        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setText(text);
        await modify.getCreator().finish(msg);
    }

    public static async notifyAdmins(
        read: IRead,
        modify: IModify,
        adminChannelName: string,
        user: IUser,
        record: UserChaosRecord,
        trigger: string,
        appId: string,
    ): Promise<void> {
        const room = await read.getRoomReader().getByName(adminChannelName);
        if (!room) { return; }

        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) { return; }

        const label = CHAOS_LABELS[record.chaosLevel] || 'Unknown';
        const lines = [
            `⚠️ **Anti-Spam Alert**`,
            `**User:** @${user.username}`,
            `**Chaos Level:** ${record.chaosLevel} — ${label}`,
            `**Trigger:** ${trigger}`,
            `**Total Flags:** ${record.totalFlags}`,
        ];

        if (record.chaosLevel === ChaosLevel.AdminReview) {
            lines.push(`\n🚨 **Action required:** Vouch to lift restriction.`);
        }

        const blocks = new BlockBuilder(appId);
        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject(lines.join('\n')),
        });
        blocks.addActionsBlock({
            elements: [
                blocks.newButtonElement({
                    text: blocks.newPlainTextObject('✅ Vouch User'),
                    value: user.id,
                    style: ButtonStyle.PRIMARY,
                    actionId: ActionId.VOUCH_USER,
                }),
                blocks.newButtonElement({
                    text: blocks.newPlainTextObject('📊 View Status'),
                    value: user.id,
                    actionId: ActionId.VIEW_STATUS,
                }),
            ],
        });

        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setBlocks(blocks);
        await modify.getCreator().finish(msg);
    }

    public static async applyAction(
        read: IRead,
        modify: IModify,
        user: IUser,
        record: UserChaosRecord,
        trigger: string,
        adminChannelName: string,
        appId: string,
    ): Promise<void> {
        switch (record.chaosLevel) {
            case ChaosLevel.Warning:
                await RestrictionManager.dmUser(read, modify, user,
                    `👋 Hey! We noticed some repeated messages from your account. ` +
                    `Please avoid posting the same content across multiple channels. This is just a friendly heads-up!`,
                );
                break;

            case ChaosLevel.Cooldown:
                await RestrictionManager.dmUser(read, modify, user,
                    `⏸️ You've been placed on a **1-minute cooldown** due to repeated spam-like activity. ` +
                    `Your messages will be temporarily blocked.`,
                );
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;

            case ChaosLevel.Restricted:
                await RestrictionManager.dmUser(read, modify, user,
                    `🚫 You've been **restricted for 10 minutes** due to continued spam-like activity. ` +
                    `Your messages are temporarily blocked.`,
                );
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;

            case ChaosLevel.AdminReview:
                await RestrictionManager.dmUser(read, modify, user,
                    `🛑 Your account has been **flagged for admin review** due to persistent spam-like activity. ` +
                    `Your messages are blocked until an admin reviews your account.`,
                );
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;
        }
    }
}
