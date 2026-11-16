//! LOCAL SANDBOX FIXTURE ONLY. The public fault controls are not part of Disburse.
use near_contract_standards::{
    fungible_token::{FungibleToken, core::FungibleTokenCore, resolver::FungibleTokenResolver},
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, json_types::U128,
    near, require,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
    owner: AccountId,
    reject_transfers: bool,
    pause_on_transfer: bool,
    bad_return: bool,
}
#[near]
impl TestToken {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            token: FungibleToken::new(b"ft".as_slice()),
            owner,
            reject_transfers: false,
            pause_on_transfer: false,
            bad_return: false,
        }
    }
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Fixture owner only"
        );
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
    }
    pub fn set_reject_transfers(&mut self, reject: bool) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Fixture owner only"
        );
        self.reject_transfers = reject;
    }
    pub fn set_pause_on_transfer(&mut self, enabled: bool) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Fixture owner only"
        );
        self.pause_on_transfer = enabled;
    }
    pub fn set_bad_return(&mut self, enabled: bool) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Fixture owner only"
        );
        self.bad_return = enabled;
    }
    /// Owner-account proxy ONLY in the synthetic node. Delays the token result until pause commits.
    pub fn pause_disburse(&self) -> Promise {
        require!(
            env::predecessor_account_id().as_str() == "usdc.tidepool-sandbox.testnet",
            "Fixture token only"
        );
        Promise::new("disburse-test-contract.testnet".parse().unwrap()).function_call(
            "pause",
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        )
    }
    /// Controlled local custody loss to exercise insufficient-balance behavior, never used live.
    pub fn fixture_burn(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Fixture owner only"
        );
        self.token.internal_withdraw(&account_id, amount.0);
    }
}
#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(!self.reject_transfers, "Fixture token rejection");
        self.token.ft_transfer(receiver_id, amount, memo);
        if self.bad_return {
            env::value_return(b"true");
        }
        if self.pause_on_transfer {
            // Deliberate fixture-only promise indirection, NOT a production-token conformance claim.
            Promise::new(self.owner.clone())
                .function_call(
                    "pause_disburse",
                    b"{}".to_vec(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(20),
                )
                .as_return()
                .detach();
        }
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}
#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
