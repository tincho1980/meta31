/**
 * D1, step 3 of section 7: a virtual candidate whose `source_key` is already stored is
 * discarded, wherever the stored row is now: in another month because it was postponed,
 * or cancelled. Stored rows always win over what the rules would generate.
 */
export function unstoredCandidates<T extends { sourceKey: string }>(
  candidates: readonly T[],
  storedKeys: ReadonlySet<string>,
): T[] {
  return candidates.filter((c) => !storedKeys.has(c.sourceKey));
}
