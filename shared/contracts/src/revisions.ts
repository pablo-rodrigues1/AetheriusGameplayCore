/** Safe nonnegative integer counters. Zero is the initial revision. */
export interface RevisionVector {
  readonly facts: number;
  readonly grants: number;
  readonly equipment: number;
  readonly effects: number;
  readonly catalog: number;
}
