export interface Asset { assetId: string; chain: string; decimals: number }
export interface Amount { atomic: bigint; asset: Asset }
export function parseAtomic(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid atomic amount or decimals');
  const n = BigInt(value); if (n <= 0n) throw new Error('Amount must be positive'); return n;
}
export function sameAsset(a: Asset, b: Asset): boolean { return a.assetId === b.assetId && a.chain === b.chain && a.decimals === b.decimals; }
export function sumAmounts(amounts: Amount[], denomination: Asset): bigint {
  return amounts.reduce((sum, x) => { if (!sameAsset(x.asset, denomination)) throw new Error('Mixed budget denomination; validated conversion is required'); if (x.atomic <= 0n) throw new Error('Amounts must be positive'); return sum + x.atomic; }, 0n);
}
