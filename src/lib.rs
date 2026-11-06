use near_sdk::{AccountId, PanicOnDefault, env, near, require};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Disburse {
    owner_id: AccountId,
    paused: bool,
}

#[near]
impl Disburse {
    #[init]
    pub fn new() -> Self {
        Self {
            owner_id: env::predecessor_account_id(),
            paused: false,
        }
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the contract owner can perform this action"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn set_context(predecessor: AccountId) {
        let mut context = VMContextBuilder::new();

        context
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor);

        testing_env!(context.build());
    }

    #[test]
    fn initializes_with_caller_as_owner() {
        set_context(accounts(1));

        let contract = Disburse::new();

        assert_eq!(contract.get_owner(), accounts(1));
        assert!(!contract.is_paused());
    }

    #[test]
    fn owner_can_pause_and_unpause() {
        set_context(accounts(1));

        let mut contract = Disburse::new();

        contract.pause();
        assert!(contract.is_paused());

        contract.unpause();
        assert!(!contract.is_paused());
    }

    #[test]
    #[should_panic(expected = "Only the contract owner")]
    fn non_owner_cannot_pause() {
        set_context(accounts(1));

        let mut contract = Disburse::new();

        set_context(accounts(2));
        contract.pause();
    }
}
