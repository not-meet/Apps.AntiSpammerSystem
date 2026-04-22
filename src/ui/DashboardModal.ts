import { IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { BlockBuilder } from '@rocket.chat/apps-engine/definition/uikit/blocks/BlockBuilder';
import { TextObjectType } from '@rocket.chat/apps-engine/definition/uikit/blocks/Objects';
import { ButtonStyle } from '@rocket.chat/apps-engine/definition/uikit/blocks/Elements';
import { IUIKitSurface, UIKitSurfaceType } from '@rocket.chat/apps-engine/definition/uikit/IUIKitSurface';
import { UserStatusStore } from '../persistence/UserStatusStore';
import { CHAOS_LABELS, ChaosLevel, UserChaosRecord } from '../types';
import { ActionId, ModalId } from './ActionIds';

function formatDuration(ms: number): string {
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) { return `${totalSec}s`; }
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) { return sec > 0 ? `${min}m ${sec}s` : `${min}m`; }
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

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
        const cooldown = rec.chaosLevel === ChaosLevel.AdminReview
            ? '🔒 Blocked (pending review)'
            : rec.cooldownUntil > Date.now()
                ? `⏳ ${formatDuration(rec.cooldownUntil - Date.now())} remaining`
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
        if (rec.cooldownUntil > Date.now()) {
            blocks.addActionsBlock({
                elements: [
                    blocks.newButtonElement({
                        text: blocks.newPlainTextObject('🔄 Reset Cooldown'),
                        value: rec.userId,
                        actionId: ActionId.RESET_COOLDOWN,
                    }),
                ],
            });
        }
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
    const cooldown = rec.chaosLevel === ChaosLevel.AdminReview
        ? '🔒 Blocked (pending review)'
        : rec.cooldownUntil > Date.now()
            ? `⏳ Expires in ${formatDuration(rec.cooldownUntil - Date.now())}`
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
