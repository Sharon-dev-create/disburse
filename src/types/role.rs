use near_sdk::near;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserRole {
    Owner,
    Administrator,
    Operator,
    Verifier,
}
