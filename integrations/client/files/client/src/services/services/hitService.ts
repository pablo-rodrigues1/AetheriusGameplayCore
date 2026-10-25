// TODO: refactor this out
import { localIdToRemoteId } from "../../view/worldViewMisc";

import { FormType, HitEvent, storage } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { MsgType } from "../../messages";
import { Hit } from "../messages/hitMessage";
import { logTrace } from "../../logging";

export class HitService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        controller.on('hit', (e) => this.onHit(e));
    }

    private onHit(e: HitEvent) {
        // Entry to the TypeScript handler of Skyrim Platform's TESHitEvent.
        this.traceNpcHit(e, 'TES_HIT_EVENT');
        // TODO: allow non-weapon sources
        const aggressor = e.aggressor.getFormID();
        if (aggressor < 0xff000000 && aggressor !== 0x14) {
            this.traceNpcHit(e, 'AGGRESSOR_NOT_LOCAL_NPC_OR_PLAYER');
            return; // all skymp npcs are FF+
        }

        if (aggressor >= 0xff000000) {
            // TODO: make host service
            const hosted = storage['hosted'];
            let alreadyHosted = false;
            if (Array.isArray(hosted)) {
                const remoteId = localIdToRemoteId(aggressor);
                if (hosted.includes(remoteId) || hosted.includes(remoteId + 0x100000000)) {
                    alreadyHosted = true;
                }
            }

            if (!alreadyHosted) {
              this.traceNpcHit(e, 'AGGRESSOR_NOT_HOSTED');
              return;
            }
        }

        const base = e.target.getBaseObject();
        const type = base?.getType();

        if (type === FormType.Static || type === FormType.MovableStatic) {
            this.traceNpcHit(e, 'TARGET_STATIC');
            return;
        }

        const isWeapon = this.sp.Weapon.from(e.source);
        const isSpell = !isWeapon && this.sp.Spell.from(e.source);
        const isScroll = !isWeapon && !isSpell && this.sp.Scroll.from(e.source);

        if (!isWeapon && !isSpell && !isScroll) {
            this.traceNpcHit(e, 'SOURCE_NOT_WEAPON_SPELL_OR_SCROLL');
            return;
        }

        // prevent double hit that happens for some reason with magic projectiles
        if (isSpell || isScroll) {
            const aggressorId = e.aggressor.getFormID();
            const now = Date.now();

            const lastHitTime = this.recentMagicHits.get(aggressorId);
            if (lastHitTime && now - lastHitTime < 100) {
                this.traceNpcHit(e, 'MAGIC_DUPLICATE');
                return;
            }

            this.recentMagicHits.set(aggressorId, now);
        }

        this.traceNpcHit(e, 'SEND_RELIABLE');
        this.controller.emitter.emit("sendMessage", {
            message: { t: MsgType.OnHit, data: this.getHitData(e) },
            reliability: "reliable"
        });
    }

    /** Diagnostic only. A failed diagnostic read must not change hit filtering.
     * No HUD notifications, messages, sounds or new packet fields/channels. */
    private traceNpcHit(e: HitEvent, reason: string): void {
        try {
            const aggressorLocal = e.aggressor.getFormID();
            if (aggressorLocal === 0x14) return;
            const targetLocal = e.target.getFormID();
            const aggressorRemote = localIdToRemoteId(aggressorLocal);
            const targetRemote = localIdToRemoteId(targetLocal);
            const hosted = storage['hosted'];
            logTrace(this, 'npcHit', JSON.stringify({
                reason, timeMs: Date.now(), sourceId: e.source ? e.source.getFormID() : 0,
                sourceType: e.source ? e.source.getType() : null,
                aggressorLocal, aggressorRemote, targetLocal, targetRemote,
                hosted: Array.isArray(hosted) && (hosted.includes(aggressorRemote) || hosted.includes(aggressorRemote + 0x100000000))
            }));
        } catch {
            logTrace(this, 'npcHit', JSON.stringify({ reason, diagnostic: 'UNAVAILABLE' }));
        }
    }

    private getHitData(e: HitEvent): Hit {
        const hitData: Hit = {
            aggressor: localIdToRemoteId(e.aggressor.getFormID()),
            isBashAttack: e.isBashAttack,
            isHitBlocked: e.isHitBlocked,
            isPowerAttack: e.isPowerAttack,
            isSneakAttack: e.isSneakAttack,
            projectile: e.projectile ? e.projectile.getFormID() : 0,
            source: e.source ? e.source.getFormID() : 0,
            target: localIdToRemoteId(e.target.getFormID())
        }
        return hitData;
    }

    private recentMagicHits: Map<number, number> = new Map();
}
