use near_sdk::{
    AccountId,
    borsh::{self, BorshDeserialize, BorshSerialize},
    near, serde,
};

use super::identifier::{IdentifierError, validate_identifier};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum TokenIdKind {
    Near(AccountId),
    External(String),
}

/// A token identity with validated construction and deserialization.
/// NEP-141 tokens use a validated NEAR account ID; external identifiers stay opaque.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TokenId(TokenIdKind);

impl TokenId {
    pub fn near(account_id: AccountId) -> Self {
        Self(TokenIdKind::Near(account_id))
    }

    pub fn external(identifier: String) -> Result<Self, IdentifierError> {
        validate_identifier(&identifier)?;
        Ok(Self(TokenIdKind::External(identifier)))
    }

    pub fn near_account_id(&self) -> Option<&AccountId> {
        match &self.0 {
            TokenIdKind::Near(account_id) => Some(account_id),
            TokenIdKind::External(_) => None,
        }
    }

    pub fn external_identifier(&self) -> Option<&str> {
        match &self.0 {
            TokenIdKind::Near(_) => None,
            TokenIdKind::External(identifier) => Some(identifier),
        }
    }

    fn validate(kind: TokenIdKind) -> Result<Self, IdentifierError> {
        if let TokenIdKind::External(identifier) = &kind {
            validate_identifier(identifier)?;
        }
        Ok(Self(kind))
    }
}

impl serde::Serialize for TokenId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde::Serialize::serialize(&self.0, serializer)
    }
}

impl BorshSerialize for TokenId {
    fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
        self.0.serialize(writer)
    }
}

impl<'de> serde::Deserialize<'de> for TokenId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let kind = <TokenIdKind as serde::Deserialize>::deserialize(deserializer)?;
        Self::validate(kind).map_err(serde::de::Error::custom)
    }
}

impl BorshDeserialize for TokenId {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let kind = TokenIdKind::deserialize_reader(reader)?;
        Self::validate(kind).map_err(|error| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, error.to_string())
        })
    }
}

impl borsh::BorshSchema for TokenId {
    fn add_definitions_recursively(
        definitions: &mut std::collections::BTreeMap<String, borsh::schema::Definition>,
    ) {
        TokenIdKind::add_definitions_recursively(definitions);
    }

    fn declaration() -> String {
        TokenIdKind::declaration()
    }
}

impl near_sdk::schemars::JsonSchema for TokenId {
    fn schema_name() -> String {
        "TokenId".to_string()
    }

    fn json_schema(
        generator: &mut near_sdk::schemars::r#gen::SchemaGenerator,
    ) -> near_sdk::schemars::schema::Schema {
        <TokenIdKind as near_sdk::schemars::JsonSchema>::json_schema(generator)
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
