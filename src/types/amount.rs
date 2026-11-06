use near_sdk::{AccountId, near};

use super::identifier::{IdentifierError, validate_identifier};

/// A NEP-141 token uses a validated NEAR account ID; other chain identifiers remain opaque.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum TokenId {
    Near(AccountId),
    External(String),
}

impl TokenId {
    pub fn near(account_id: AccountId) -> Self {
        Self::Near(account_id)
    }

    pub fn external(identifier: String) -> Result<Self, IdentifierError> {
        validate_identifier(&identifier)?;
        Ok(Self::External(identifier))
    }

    pub fn near_account_id(&self) -> Option<&AccountId> {
        match self {
            Self::Near(account_id) => Some(account_id),
            Self::External(_) => None,
        }
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
