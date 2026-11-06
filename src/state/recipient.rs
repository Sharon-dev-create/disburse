use near_sdk::{AccountId, near};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recipient {
    pub id: u64,
    pub owner_id: AccountId,
    pub display_name: Option<String>,
    pub active: bool,
    pub created_at_ns: u64,
}
