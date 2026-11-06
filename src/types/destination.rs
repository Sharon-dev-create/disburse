use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    near, serde,
};

use super::identifier::{IdentifierError, validate_identifier};

/// Provider/chain-native identifier. This type does not claim the chain is supported.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ChainId(String);

impl ChainId {
    pub fn new(value: String) -> Result<Self, IdentifierError> {
        validate_identifier(&value)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn validate(value: String) -> Result<Self, IdentifierError> {
        validate_identifier(&value)?;
        Ok(Self(value))
    }
}

impl serde::Serialize for ChainId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde::Serialize::serialize(&self.0, serializer)
    }
}

impl BorshSerialize for ChainId {
    fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
        self.0.serialize(writer)
    }
}

impl<'de> serde::Deserialize<'de> for ChainId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = <String as serde::Deserialize>::deserialize(deserializer)?;
        Self::validate(value).map_err(serde::de::Error::custom)
    }
}

impl BorshDeserialize for ChainId {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let value = String::deserialize_reader(reader)?;
        Self::validate(value).map_err(|error| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, error.to_string())
        })
    }
}

impl borsh::BorshSchema for ChainId {
    fn add_definitions_recursively(
        definitions: &mut std::collections::BTreeMap<String, borsh::schema::Definition>,
    ) {
        <String as borsh::BorshSchema>::add_definitions_recursively(definitions);
    }

    fn declaration() -> String {
        <String as borsh::BorshSchema>::declaration()
    }
}

impl near_sdk::schemars::JsonSchema for ChainId {
    fn schema_name() -> String {
        "ChainId".to_string()
    }

    fn json_schema(
        generator: &mut near_sdk::schemars::gen::SchemaGenerator,
    ) -> near_sdk::schemars::schema::Schema {
        <String as near_sdk::schemars::JsonSchema>::json_schema(generator)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutDestination {
    pub chain_id: ChainId,
    pub recipient_address: String,
}
