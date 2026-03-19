import { IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { BlockBuilder } from '@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder';
import { TextObjectType } from '@rocket.chat/apps-engine/definition/uikit/blocks/Objects';
import { ButtonStyle } from '@rocket.chat/apps-engine/definition/uikit/blocks/Elements';
import { IUIKitSurface, UIKitSurfaceType } from '@rocket.chat/apps-engine/definition/uikit/IUIKitSurface';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { CHAOS_LABELS, ChaosLevel, UserChaosRecord } from '../types';
import { ActionId, ModalId } from './ActionIds';

export async function buildDashboardModal(read: IRead, appId: string): Promise<IUIKitSurface> {
    const blocks = new BlockBuilder(appId);
    const allRecords = await UserStatusStore.getAll(read);
    const flagged = allRecords.filter((r) => r.chaosLevel > ChaosLevel.Clean);

    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(
            flagged.length > 0
                ? `🛡️ **Flagged Users** — ${flagged.length} user(s) require attention`
                : '✅ **No flagged users.** All clear!',
        ),
    });

    if (flagged.length > 0) {
        blocks.addDividerBlock();
    }

    for (const rec of flagged) {
        const label = CHAOS_LABELS[rec.chaosLevel] || 'Unknown';
        const cooldown = rec.cooldownUntil > Date.now()
            ? `⏳ ${Math.ceil((rec.cooldownUntil - Date.now()) / 1000)}s remaining`
            : '—';

        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject(
                `**@${rec.username}**\n` +
                `Level: ${rec.chaosLevel} (${label}) · Flags: ${rec.totalFlags} · Cooldown: ${cooldown}`,
            ),
            accessory: blocks.newButtonElement({
                text: blocks.newPlainTextObject('✅ Vouch'),
                value: rec.userId,
                style: ButtonStyle.PRIMARY,
                actionId: ActionId.VOUCH_USER,
            }),
        });
        blocks.addDividerBlock();
    }

    return {
        appId,
        id: ModalId.DASHBOARD,
        type: UIKitSurfaceType.MODAL,
        title: { type: TextObjectType.PLAINTEXT, text: '🛡️ Anti-Spam Dashboard' },
        blocks: blocks.getBlocks(),
        close: {
            type: 'button' as any,
            text: { type: TextObjectType.PLAINTEXT, text: 'Close' },
            actionId: 'close-dashboard',
        },
    };
}

export function buildUserStatusBlocks(
    blocks: BlockBuilder,
    rec: UserChaosRecord,
): void {
    const label = CHAOS_LABELS[rec.chaosLevel] || 'Unknown';
    const cooldown = rec.cooldownUntil > Date.now()
        ? `⏳ Expires in ${Math.ceil((rec.cooldownUntil - Date.now()) / 1000)}s`
        : 'None';

    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(`📊 **Status for @${rec.username}**`),
    });
    blocks.addDividerBlock();
    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject(
            `**Chaos Level:** ${rec.chaosLevel} — ${label}\n` +
            `**Total Flags:** ${rec.totalFlags}\n` +
            `**Active Cooldown:** ${cooldown}\n` +
            (rec.vouchedBy ? `**Previously vouched by:** @${rec.vouchedBy}` : ''),
        ),
    });
}
