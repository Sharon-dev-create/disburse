# M5-F.1D account creation review

Account documentation correction: PASS; future setup prerequisites remain unresolved.

Inspected the original controlled transaction plan and M5-F.1C correction. Direct protocol child creation correctly uses disburse-m12.testnet as future verified signer and each new child as receiver: recipient.disburse-m12.testnet, approver.disburse-m12.testnet, executor.disburse-m12.testnet. CreateAccount/Transfer/AddKey have no function-call prepaid-gas field; Transfer amount is distinct from attached FunctionCall deposit. Separate keys and fee estimates remain unresolved. Installed CLI creation help was captured in m5f1d/cli-help.log.

Parent creation cannot be signed by the absent parent. A separately verified sponsor-by-faucet-service flow is the safe proposed preparation option; service sponsor, actual transaction receiver, funding rules, approved public key and resulting control must be verified before any approval. A registrar FunctionCall would target its verified registrar, not automatically the new account; no exact registrar is assumed here. No executable creation command or key generation was performed. Parent procedure remains an operational prerequisite, not a software vulnerability. The corrected plan does not target the existing historical contract for CreateAccount.

Candidate native identity remains disburse-test-contract.testnet; a new deployment identity is not supported by unchanged candidate guards. No live account absence or ownership is freshly claimed.
