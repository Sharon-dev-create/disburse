use near_sdk::near;

/// Opaque token identity. It may be a NEP-141 account ID or a chain-native identifier.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TokenId(String);

impl TokenId {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An integer quantity in a token's smallest units, tied to its identity and decimals.
/// No cross-token arithmetic or ordering is provided.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenAmount {
    token_id: TokenId,
    atomic_amount: u128,
    decimals: u8,
}

impl TokenAmount {
    pub fn new(token_id: TokenId, atomic_amount: u128, decimals: u8) -> Self {
        Self {
            token_id,
            atomic_amount,
            decimals,
        }
    }

    pub fn token_id(&self) -> &TokenId {
        &self.token_id
    }

    pub fn atomic_amount(&self) -> u128 {
        self.atomic_amount
    }

    pub fn decimals(&self) -> u8 {
        self.decimals
    }
}
