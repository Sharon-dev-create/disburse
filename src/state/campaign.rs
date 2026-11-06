use near_sdk::{AccountId, near};

use crate::types::status::CampaignStatus;

/// Campaign accounting invariant for funded campaigns: reserved + spent <= funded <= budget.
/// Approved budget is an authorization ceiling, not evidence of funds received.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Campaign {
    pub id: u64,
    pub creator_id: AccountId,
    pub title: String,
    pub token_id: AccountId,
    pub budget: u128,
    pub funded: u128,
    pub reserved: u128,
    pub spent: u128,
    pub status: CampaignStatus,
    pub created_at_ns: u64,
}
