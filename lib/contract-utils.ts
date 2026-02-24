/**
 * Calculate rollover CUs from a completed contract.
 * Business rule: max 10% of the previous contract's total CUs can roll over.
 */
export function calculateRollover(previousContract: {
  totalContentUnits: number;
  usedContentUnits: number;
}): number {
  const unused =
    previousContract.totalContentUnits - previousContract.usedContentUnits;
  const maxRollover = previousContract.totalContentUnits * 0.1;
  return Math.max(0, Math.min(unused, maxRollover));
}

/**
 * Get the effective balance for a contract, including rollover.
 */
export function getContractBalance(contract: {
  totalContentUnits: number;
  usedContentUnits: number;
  rolloverUnits: number;
}): {
  total: number;
  used: number;
  remaining: number;
  percentUsed: number;
} {
  const total = contract.totalContentUnits + contract.rolloverUnits;
  const used = contract.usedContentUnits;
  const remaining = Math.max(0, total - used);
  const percentUsed = total > 0 ? (used / total) * 100 : 0;
  return { total, used, remaining, percentUsed };
}
