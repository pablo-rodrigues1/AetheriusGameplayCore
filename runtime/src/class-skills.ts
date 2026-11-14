import type { GrantSet, SessionBinding } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { CLASS_SKILL_NAMES, type ClassSkillValues } from '../../modules/class-progression-system/src/skills.ts';
import type { ClassCombatProfileFacts } from './combat-profile.ts';
import type { ClientDelivery } from './client-delivery.ts';

/** Catalog stages already contain the cumulative Q14 values for all 18 skills.
 * Selecting the final eligible stage also covers staff level jumps and decreases. */
export function classSkillValues(data: DomainData, classId: string, level: number): ClassSkillValues {
  if (data.domain !== 'classes' || !Number.isInteger(level) || level < 1 || level > 40)
    throw Error('CLASS_SKILL_LEVEL_OR_CATALOG_INVALID');
  const definition = data.classes?.find(entry => entry.id === classId);
  const stage = definition?.stages.filter(entry => entry.level <= level).sort((a,b) => a.level-b.level).at(-1);
  const skills = (stage as { skills?: Record<string, unknown> } | undefined)?.skills;
  if (!skills || Object.keys(skills).length !== CLASS_SKILL_NAMES.length || CLASS_SKILL_NAMES.some(name =>
    !Number.isSafeInteger(skills[name]) || (skills[name] as number) < 0)) throw Error('CLASS_STAGE_SKILLS_UNAVAILABLE');
  return Object.freeze(Object.fromEntries(CLASS_SKILL_NAMES.map(name => [name, skills[name]]))) as ClassSkillValues;
}

/** Projection of committed class facts through the existing authenticated spawn
 * channel. This does not turn client ActorValues into server combat authority. */
export class ClassSkillsProjection {
  private delivered = new Map<number, { epoch: string; session: string; cycle: string; content: string }>();
  constructor(private channel: ClientDelivery, private data: DomainData,
    private current: (binding: SessionBinding) => boolean, private warn: (message: string) => void) {}
  publish(binding: SessionBinding, set: GrantSet, facts: ClassCombatProfileFacts | undefined): void {
    if (!this.current(binding) || !facts?.classId) return;
    const cycle = this.channel.current(binding);
    if (!cycle?.ready || !cycle.cycle || !cycle.challenge) return;
    try {
      const skills = classSkillValues(this.data, facts.classId, facts.level);
      const content = JSON.stringify({ revision: set.revision, skills });
      const previous = this.delivered.get(binding.actorRef.actorId);
      if (previous?.epoch === binding.epoch && previous.session === cycle.session
        && previous.cycle === cycle.cycle && previous.content === content) return;
      if (this.channel.send(cycle, { type: 'skills', cycle: cycle.cycle, challenge: cycle.challenge,
        revision: set.revision, skills })) this.delivered.set(binding.actorRef.actorId,
          { epoch: binding.epoch, session: cycle.session, cycle: cycle.cycle, content });
    } catch { this.warn('class skills UNSUPPORTED: CLASS_STAGE_SKILLS_UNAVAILABLE'); }
  }
  clear(binding: SessionBinding): void {
    if (this.delivered.get(binding.actorRef.actorId)?.epoch === binding.epoch) this.delivered.delete(binding.actorRef.actorId);
  }
  shutdown(): void { this.delivered.clear(); }
}
