export interface SpikeGrant {
  readonly kind: 'spell';
  readonly definition: { readonly stableFormKey: string; readonly recordType: 'SPEL' };
  readonly source: { readonly kind: 'STANDING_STONE'; readonly key: 'standing-stone-choice' };
}
export interface StandingStoneMp {
  onActivate?: ((targetId: number, casterId: number) => unknown) | undefined;
  getIdFromDesc(desc: string): number;
  getDescFromId(formId: number): string;
  callPapyrusFunction(callType: string, className: string, functionName: string,
    self: { type: 'form'; desc: string }, args: unknown[]): unknown;
  isConnected?(userId: number): boolean;
  getUserActor?(userId: number): number | undefined;
  getActorsByProfileId?(profileId: number): number[] | undefined;
}
export function composeStandingStoneGrants(stoneKey: string | undefined): readonly SpikeGrant[];
export function planGrantProjection(previous: readonly SpikeGrant[], next: readonly SpikeGrant[]):
  Readonly<{ removed: readonly SpikeGrant[]; added: readonly SpikeGrant[] }>;
export function createStandingStoneSpike(args: {
  mp: StandingStoneMp;
  pg: { init(): { connect(): Promise<{
    query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, any>[] }>;
    release(): void;
  }> } };
  log: { info(message: string): void };
}): {
  initialize(): Promise<void>;
  shutdown(): void;
  chooseStandingStone(command: { requestId: string; characterKey: string; stone: string; actorId: number }): Promise<Record<string, unknown>>;
  rehydrate(characterKey: string, actorId: number): Promise<Record<string, unknown>>;
};
export const standingStoneDefinitions: Readonly<Record<string, Readonly<{
  spell: string; plugin: string; formId: string;
  additionalSpells?: readonly Readonly<{ stableFormKey: string; plugin: string; formId: string }>[];
}>>>;
