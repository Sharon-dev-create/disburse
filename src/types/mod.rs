pub mod amount;
pub mod destination;
pub mod evidence;
pub mod identifier;
pub mod role;
pub mod status;

#[cfg(test)]
mod tests {
    use near_sdk::{borsh, serde_json, test_utils::accounts};

    use crate::{
        state::{campaign::Campaign, payout::Payout, recipient::Recipient},
        types::{
            amount::{TokenAmount, TokenId},
            destination::{ChainId, PayoutDestination, RecipientAddress},
            evidence::SettlementEvidence,
            role::UserRole,
            status::{CampaignStatus, PayoutStatus},
        },
    };

    fn campaign() -> Campaign {
        Campaign {
            id: 7,
            creator_id: accounts(1),
            title: "Grants".to_string(),
            token_id: accounts(2),
            budget: 1_000,
            funded: 500,
            reserved: 100,
            spent: 50,
            status: CampaignStatus::Approved,
            created_at_ns: 123,
        }
    }

    fn token_amount(token: TokenId, amount: u128, decimals: u8) -> TokenAmount {
        TokenAmount::new(token, amount, decimals)
    }

    fn round_trip_borsh<T>(value: &T) -> T
    where
        T: borsh::BorshSerialize + borsh::BorshDeserialize,
    {
        borsh::from_slice(&borsh::to_vec(value).unwrap()).unwrap()
    }

    #[test]
    fn campaign_round_trips_borsh_and_json() {
        let original = campaign();
        assert_eq!(round_trip_borsh(&original), original);
        let json = serde_json::to_string(&original).unwrap();
        assert_eq!(serde_json::from_str::<Campaign>(&json).unwrap(), original);
    }

    #[test]
    fn payout_round_trips_borsh_and_json() {
        let original = Payout {
            id: 4,
            campaign_id: 7,
            recipient_near_account_id: Some(accounts(3)),
            input_amount: token_amount(TokenId::near(accounts(2)), 250, 6),
            destination: PayoutDestination {
                chain_id: ChainId::new("eip155:11155111".to_string()).unwrap(),
                recipient_address: RecipientAddress::new(
                    "0x1111111111111111111111111111111111111111".to_string(),
                )
                .unwrap(),
            },
            expected_output_amount: token_amount(
                TokenId::external("eip155:11155111/erc20:0xtoken".to_string()).unwrap(),
                125,
                6,
            ),
            status: PayoutStatus::Created,
            created_at_ns: 456,
            execution_reference: None,
            settlement_evidence_reference: None,
        };
        assert_eq!(round_trip_borsh(&original), original);
        let json = serde_json::to_string(&original).unwrap();
        assert_eq!(serde_json::from_str::<Payout>(&json).unwrap(), original);
        assert_eq!(
            original.expected_output_amount.token_id(),
            &TokenId::external("eip155:11155111/erc20:0xtoken".to_string()).unwrap()
        );
    }

    #[test]
    fn campaign_status_round_trips_borsh_and_json() {
        let status = CampaignStatus::Approved;
        assert_eq!(round_trip_borsh(&status), status);
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(
            serde_json::from_str::<CampaignStatus>(&json).unwrap(),
            status
        );
    }

    #[test]
    fn payout_status_round_trips_borsh_and_json() {
        let status = PayoutStatus::PendingVerification;
        assert_eq!(round_trip_borsh(&status), status);
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(serde_json::from_str::<PayoutStatus>(&json).unwrap(), status);
    }

    #[test]
    fn token_amount_keeps_atomic_value_decimals_and_token_identity() {
        let amount = token_amount(TokenId::external("token.one".to_string()).unwrap(), 42, 8);
        assert_eq!(amount.atomic_amount(), 42);
        assert_eq!(amount.decimals(), 8);
        assert_eq!(
            amount.token_id(),
            &TokenId::external("token.one".to_string()).unwrap()
        );
        assert_ne!(
            amount,
            token_amount(TokenId::external("token.two".to_string()).unwrap(), 42, 8)
        );
    }

    #[test]
    fn near_token_identity_uses_validated_account_id() {
        let token = TokenId::near(accounts(2));
        assert_eq!(token.near_account_id(), Some(&accounts(2)));
    }

    #[test]
    fn external_token_identifiers_reject_empty_and_whitespace() {
        use super::identifier::IdentifierError;

        assert_eq!(
            TokenId::external(String::new()),
            Err(IdentifierError::Empty)
        );
        assert_eq!(
            TokenId::external(" \t ".to_string()),
            Err(IdentifierError::Empty)
        );

        let token = TokenId::external("  opaque:token  ".to_string()).unwrap();
        assert_eq!(token.external_identifier(), Some("  opaque:token  "));
    }

    #[test]
    fn token_id_deserialization_rejects_empty_external_identifiers() {
        let invalid_json = r#"{"External":""}"#;
        assert!(serde_json::from_str::<TokenId>(invalid_json).is_err());

        // Borsh enum variant 1 (External), followed by an empty string length.
        let invalid_borsh = [1_u8, 0, 0, 0, 0];
        assert!(borsh::from_slice::<TokenId>(&invalid_borsh).is_err());
    }

    #[test]
    fn token_amount_deserialization_rejects_invalid_nested_token_id() {
        let invalid_json = r#"{"token_id":{"External":" "},"atomic_amount":1,"decimals":0}"#;
        assert!(serde_json::from_str::<TokenAmount>(invalid_json).is_err());

        let valid = token_amount(TokenId::near(accounts(2)), 1, 0);
        assert_eq!(
            serde_json::from_str::<TokenAmount>(&serde_json::to_string(&valid).unwrap()).unwrap(),
            valid
        );
    }

    #[test]
    fn chain_identifiers_reject_empty_and_whitespace() {
        use super::identifier::IdentifierError;

        assert_eq!(ChainId::new(String::new()), Err(IdentifierError::Empty));
        assert_eq!(
            ChainId::new(" \n ".to_string()),
            Err(IdentifierError::Empty)
        );

        let chain = ChainId::new(" custom:network ".to_string()).unwrap();
        assert_eq!(chain.as_str(), " custom:network ");
    }

    #[test]
    fn chain_id_deserialization_rejects_empty_identifiers() {
        assert!(serde_json::from_str::<ChainId>("\" \t \"").is_err());
        assert!(borsh::from_slice::<ChainId>(&[0, 0, 0, 0]).is_err());
    }

    #[test]
    fn recipient_address_constructor_preserves_nonblank_opaque_value() {
        use super::identifier::IdentifierError;

        assert_eq!(
            RecipientAddress::new(String::new()),
            Err(IdentifierError::Empty)
        );
        assert_eq!(
            RecipientAddress::new(" \t\n ".to_string()),
            Err(IdentifierError::Empty)
        );

        let address = RecipientAddress::new("  chain-specific:recipient  ".to_string()).unwrap();
        assert_eq!(address.as_str(), "  chain-specific:recipient  ");
    }

    #[test]
    fn recipient_address_round_trips_json_and_borsh() {
        let address = RecipientAddress::new("opaque:destination".to_string()).unwrap();
        assert_eq!(round_trip_borsh(&address), address);
        let json = serde_json::to_string(&address).unwrap();
        assert_eq!(
            serde_json::from_str::<RecipientAddress>(&json).unwrap(),
            address
        );
    }

    #[test]
    fn recipient_address_rejects_empty_values_during_json_and_borsh_deserialization() {
        for json in ["\"\"", "\" \t \""] {
            assert!(serde_json::from_str::<RecipientAddress>(json).is_err());
        }
        for borsh_bytes in [&[0, 0, 0, 0][..], &[1, 0, 0, 0, b' '][..]] {
            assert!(borsh::from_slice::<RecipientAddress>(borsh_bytes).is_err());
        }
    }

    #[test]
    fn payout_destination_rejects_blank_recipient_during_json_deserialization() {
        let blank = r#"{"chain_id":"eip155:1","recipient_address":"  "}"#;
        assert!(serde_json::from_str::<PayoutDestination>(blank).is_err());
    }

    #[test]
    fn destination_represents_an_evm_recipient_without_assuming_support() {
        let destination = PayoutDestination {
            chain_id: ChainId::new("eip155:1".to_string()).unwrap(),
            recipient_address: RecipientAddress::new(
                "0x2222222222222222222222222222222222222222".to_string(),
            )
            .unwrap(),
        };
        assert_eq!(destination.chain_id.as_str(), "eip155:1");
        assert!(destination.recipient_address.as_str().starts_with("0x"));
    }

    #[test]
    fn settlement_evidence_records_verifier_assertion() {
        let evidence = SettlementEvidence {
            payout_id: 4,
            provider_id: "evm-rpc".to_string(),
            destination_chain_id: ChainId::new("eip155:1".to_string()).unwrap(),
            destination_transaction_reference: "0xdeadbeef".to_string(),
            transaction_event_identifier: Some("12".to_string()),
            recipient_address: RecipientAddress::new(
                "0x2222222222222222222222222222222222222222".to_string(),
            )
            .unwrap(),
            output_amount: token_amount(
                TokenId::external("eip155:1/erc20:0xabc".to_string()).unwrap(),
                90,
                6,
            ),
            verifier_id: accounts(4),
            verification_method: "receipt-and-transfer-log".to_string(),
            verified_at_ns: 789,
            evidence_reference: Some("sha256:example".to_string()),
            content_hash: "a".repeat(64),
        };
        assert_eq!(round_trip_borsh(&evidence), evidence);
        let decoded: SettlementEvidence =
            serde_json::from_str(&serde_json::to_string(&evidence).unwrap()).unwrap();
        assert_eq!(decoded, evidence);
    }

    #[test]
    fn user_role_round_trips_borsh_and_json() {
        let role = UserRole::Verifier;
        assert_eq!(round_trip_borsh(&role), role);
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(serde_json::from_str::<UserRole>(&json).unwrap(), role);
    }

    #[test]
    fn recipient_round_trips_borsh_and_json() {
        let recipient = Recipient {
            id: 2,
            owner_id: accounts(1),
            display_name: Some("Alice".to_string()),
            active: true,
            created_at_ns: 999,
        };
        assert_eq!(round_trip_borsh(&recipient), recipient);
        let json = serde_json::to_string(&recipient).unwrap();
        assert_eq!(serde_json::from_str::<Recipient>(&json).unwrap(), recipient);
    }
}
