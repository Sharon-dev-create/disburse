use near_sdk::near;

use super::amount::TokenId;

/// Provider/chain-native identifier. This type does not claim the chain is supported.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ChainId(String);

impl ChainId {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutDestination {
    pub chain_id: ChainId,
    pub recipient_address: String,
    pub expected_output_token_id: TokenId,
}
