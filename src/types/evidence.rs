use near_sdk::{AccountId, near};

use super::{amount::TokenAmount, destination::ChainId};

/// Evidence is a claim supplied by an authorized verifier. The contract cannot itself
/// prove arbitrary destination-chain execution from this representation alone.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementEvidence {
    pub payout_id: u64,
    pub destination_chain_id: ChainId,
    pub destination_transaction_reference: String,
    pub recipient_address: String,
    pub output_amount: TokenAmount,
    pub verifier_id: AccountId,
    pub verification_method: String,
    pub verified_at_ns: u64,
    pub evidence_reference: Option<String>,
}
