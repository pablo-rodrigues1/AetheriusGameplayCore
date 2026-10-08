import type { StableFormKey } from '../../../shared/contracts/src/index.ts';
export interface RaceOwnership {
  readonly raceKey: StableFormKey;
  readonly raceEditorId: string;
  readonly stableFormKey: StableFormKey;
  readonly editorId: string;
  readonly recordType: 'SPEL' | 'PERK';
  readonly grantOwner: 'NATIVE_CLIENT';
  readonly resultOwner: 'NATIVE_CLIENT';
  readonly family: string;
  readonly resultStatus: string;
  readonly classification: { readonly class:string; readonly family:string; readonly reason:string; readonly confidence:string } | null;
  readonly appliedBy: readonly StableFormKey[];
  readonly details: readonly {
    readonly key?: string; readonly family:string; readonly mechanism:string;
    readonly entryPoint?:string; readonly modification?:string; readonly value?:string;
    readonly rank?:string; readonly priority?:string; readonly conditionEvidence?:string;
  }[];
}
