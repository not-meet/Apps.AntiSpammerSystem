"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RestrictionManager = void 0;
const rooms_1 = require("@rocket.chat/apps-engine/definition/rooms");
const BlockBuilder_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder");
const Elements_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/Elements");
const types_1 = require("../types");
const ActionIds_1 = require("../ui/ActionIds");
class RestrictionManager {
    static async dmUser(read, modify, targetUser, text) {
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) {
            return;
        }
        let room = await read.getRoomReader().getDirectByUsernames([
            appUser.username,
            targetUser.username,
        ]);
        if (!room) {
            const roomBuilder = modify.getCreator().startRoom()
                .setType(rooms_1.RoomType.DIRECT_MESSAGE)
                .setCreator(appUser)
                .setMembersToBeAddedByUsernames([appUser.username, targetUser.username]);
            const roomId = await modify.getCreator().finish(roomBuilder);
            room = await read.getRoomReader().getById(roomId);
        }
        if (!room) {
            return;
        }
        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setText(text);
        await modify.getCreator().finish(msg);
    }
    static async notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId) {
        const room = await read.getRoomReader().getByName(adminChannelName);
        if (!room) {
            return;
        }
        const appUser = await read.getUserReader().getAppUser();
        if (!appUser) {
            return;
        }
        const label = types_1.CHAOS_LABELS[record.chaosLevel] || 'Unknown';
        const lines = [
            `⚠️ **Anti-Spam Alert**`,
            `**User:** @${user.username}`,
            `**Chaos Level:** ${record.chaosLevel} — ${label}`,
            `**Trigger:** ${trigger}`,
            `**Total Flags:** ${record.totalFlags}`,
        ];
        if (record.chaosLevel === types_1.ChaosLevel.AdminReview) {
            lines.push(`\n🚨 **Action required:** Vouch to lift restriction.`);
        }
        const blocks = new BlockBuilder_1.BlockBuilder(appId);
        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject(lines.join('\n')),
        });
        blocks.addActionsBlock({
            elements: [
                blocks.newButtonElement({
                    text: blocks.newPlainTextObject('✅ Vouch User'),
                    value: user.id,
                    style: Elements_1.ButtonStyle.PRIMARY,
                    actionId: ActionIds_1.ActionId.VOUCH_USER,
                }),
                blocks.newButtonElement({
                    text: blocks.newPlainTextObject('📊 View Status'),
                    value: user.id,
                    actionId: ActionIds_1.ActionId.VIEW_STATUS,
                }),
            ],
        });
        const msg = modify.getCreator().startMessage()
            .setSender(appUser)
            .setRoom(room)
            .setBlocks(blocks);
        await modify.getCreator().finish(msg);
    }
    static async applyAction(read, modify, user, record, trigger, adminChannelName, appId) {
        switch (record.chaosLevel) {
            case types_1.ChaosLevel.Warning:
                await RestrictionManager.dmUser(read, modify, user, `👋 Hey! We noticed some repeated messages from your account. ` +
                    `Please avoid posting the same content across multiple channels. This is just a friendly heads-up!`);
                break;
            case types_1.ChaosLevel.Cooldown:
                await RestrictionManager.dmUser(read, modify, user, `⏸️ You've been placed on a **1-minute cooldown** due to repeated spam-like activity. ` +
                    `Your messages will be temporarily blocked.`);
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;
            case types_1.ChaosLevel.Restricted:
                await RestrictionManager.dmUser(read, modify, user, `🚫 You've been **restricted for 10 minutes** due to continued spam-like activity. ` +
                    `Your messages are temporarily blocked.`);
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;
            case types_1.ChaosLevel.AdminReview:
                await RestrictionManager.dmUser(read, modify, user, `🛑 Your account has been **flagged for admin review** due to persistent spam-like activity. ` +
                    `Your messages are blocked until an admin reviews your account.`);
                await RestrictionManager.notifyAdmins(read, modify, adminChannelName, user, record, trigger, appId);
                break;
        }
    }
}
exports.RestrictionManager = RestrictionManager;
