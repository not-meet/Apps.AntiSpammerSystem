"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUserStatusBlocks = exports.buildDashboardModal = void 0;
const BlockBuilder_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder");
const Objects_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/Objects");
const Elements_1 = require("@rocket.chat/apps-engine/definition/uikit/blocks/Elements");
const IUIKitSurface_1 = require("@rocket.chat/apps-engine/definition/uikit/IUIKitSurface");
const UserStatusStore_1 = require("../persistence/UserStatusStore");
const types_1 = require("../types");
const ActionIds_1 = require("./ActionIds");
async function buildDashboardModal(read, appId) {
    const blocks = new BlockBuilder_1.BlockBuilder(appId);
    const allRecords = await UserStatusStore_1.UserStatusStore.getAll(read);
    const flagged = allRecords.filter((r) => r.chaosLevel > types_1.ChaosLevel.Clean);
    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(flagged.length > 0
            ? `🛡️ **Flagged Users** — ${flagged.length} user(s) require attention`
            : '✅ **No flagged users.** All clear!'),
    });
    if (flagged.length > 0) {
        blocks.addDividerBlock();
    }
    for (const rec of flagged) {
        const label = types_1.CHAOS_LABELS[rec.chaosLevel] || 'Unknown';
        const cooldown = rec.cooldownUntil > Date.now()
            ? `⏳ ${Math.ceil((rec.cooldownUntil - Date.now()) / 1000)}s remaining`
            : '—';
        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject(`**@${rec.username}**\n` +
                `Level: ${rec.chaosLevel} (${label}) · Flags: ${rec.totalFlags} · Cooldown: ${cooldown}`),
            accessory: blocks.newButtonElement({
                text: blocks.newPlainTextObject('✅ Vouch'),
                value: rec.userId,
                style: Elements_1.ButtonStyle.PRIMARY,
                actionId: ActionIds_1.ActionId.VOUCH_USER,
            }),
        });
        blocks.addDividerBlock();
    }
    return {
        appId,
        id: ActionIds_1.ModalId.DASHBOARD,
        type: IUIKitSurface_1.UIKitSurfaceType.MODAL,
        title: { type: Objects_1.TextObjectType.PLAINTEXT, text: '🛡️ Anti-Spam Dashboard' },
        blocks: blocks.getBlocks(),
        close: {
            type: 'button',
            text: { type: Objects_1.TextObjectType.PLAINTEXT, text: 'Close' },
            actionId: 'close-dashboard',
        },
    };
}
exports.buildDashboardModal = buildDashboardModal;
function buildUserStatusBlocks(blocks, rec) {
    const label = types_1.CHAOS_LABELS[rec.chaosLevel] || 'Unknown';
    const cooldown = rec.cooldownUntil > Date.now()
        ? `⏳ Expires in ${Math.ceil((rec.cooldownUntil - Date.now()) / 1000)}s`
        : 'None';
    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(`📊 **Status for @${rec.username}**`),
    });
    blocks.addDividerBlock();
    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(`**Chaos Level:** ${rec.chaosLevel} — ${label}\n` +
            `**Total Flags:** ${rec.totalFlags}\n` +
            `**Active Cooldown:** ${cooldown}\n` +
            (rec.vouchedBy ? `**Previously vouched by:** @${rec.vouchedBy}` : '')),
    });
}
exports.buildUserStatusBlocks = buildUserStatusBlocks;
