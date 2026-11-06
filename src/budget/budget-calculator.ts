import { sumAmounts, type Amount, type Asset } from '../domain/money.js';
export interface CampaignBudget { approved:bigint; denomination:Asset; quotes:Amount[]; separatelyPayableFees:Amount[] }
export function calculateExposure(input:CampaignBudget):bigint {
  if(input.approved<=0n)throw new Error('Approved budget must be positive');
  const required=sumAmounts([...input.quotes,...input.separatelyPayableFees],input.denomination);
  if(required>input.approved)throw new Error(`Budget exceeded: required ${required}, approved ${input.approved}`);
  return required;
}
