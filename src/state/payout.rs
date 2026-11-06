use near_sdk::{AccountId, near};

use crate::types::{amount::TokenAmount, destination::PayoutDestination, status::PayoutStatus};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payout {
    pub id: u64,
    pub campaign_id: u64,
    pub recipient_near_account_id: Option<AccountId>,
    /// The token identity is carried by this amount, avoiding a duplicate token field.
    pub input_amount: TokenAmount,
    pub destination: PayoutDestination,
    pub expected_output_amount: TokenAmount,
    pub status: PayoutStatus,
    pub created_at_ns: u64,
    /// Correlation only; a submitted execution is not proof of recipient settlement.
    pub execution_reference: Option<String>,
    pub settlement_evidence_reference: Option<String>,
}
