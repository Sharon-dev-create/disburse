import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpNearRpcTransport, NearContractReader } from "../src/near/rpc.ts";
import { ACTIVE_TESTNET } from "../src/near/active-testnet.ts";
import { startExecutionApiServer } from "../src/api/http.ts";
const budget = "900719925474099312345";
const metadata =
  '{"id":0,"creator_id":"disburse-topg.testnet","title":"Disburse Milestone 3 funding verification","token_id":"usdc.tidepool-sandbox.testnet","budget":900719925474099312345,"funded":1000000,"reserved":0,"spent":0,"status":"Approved","created_at_ns":1794722173685400100}';
function fixture() {
  let campaign: string | null = metadata;
  let available = "1000000";
  const methods: string[] = [];
  const transport = new HttpNearRpcTransport(
    "https://rpc.testnet.near.org",
    100,
    async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: {
          request_type?: string;
          account_id?: string;
          method_name?: string;
          args_base64?: string;
        };
      };
      if (request.method === "status")
        return Response.json({ result: { chain_id: "testnet" } });
      if (request.params.request_type === "view_account")
        return Response.json({
          result: { code_hash: ACTIVE_TESTNET.codeHash },
        });
      const m = request.params.method_name!;
      methods.push(m);
      let result: unknown;
      switch (m) {
        case "get_campaign": {
          assert.deepEqual(
            JSON.parse(
              Buffer.from(request.params.args_base64!, "base64").toString(),
            ),
            { campaign_id: 0 },
          );
          return Response.json({
            result: { result: [...Buffer.from(campaign ?? "null")] },
          });
        }
        case "get_campaign_payout_accounting":
          result = {
            campaign_id: 0,
            budget,
            funded: "1000000",
            reserved: "0",
            spent: "0",
            available,
          };
          break;
        case "get_campaign_funding":
          result = {
            campaign_id: 0,
            token_id: ACTIVE_TESTNET.tokenId,
            budget,
            funded: "1000000",
            remaining_budget: "900719925474098312345",
          };
          break;
        case "ft_metadata":
          result = { decimals: 6 };
          break;
        case "get_owner":
          result = ACTIVE_TESTNET.ownerId;
          break;
        case "is_paused":
          result = false;
          break;
        case "get_campaign_count":
          result = 1;
          break;
        case "is_accepted_token":
        case "has_role":
          result = true;
          break;
        default:
          throw Error("Unexpected operation " + m);
      }
      return Response.json({
        result: { result: [...Buffer.from(JSON.stringify(result))] },
      });
    },
  );
  return {
    reader: new NearContractReader(
      { networkId: "testnet", contractId: ACTIVE_TESTNET.contractId },
      transport,
    ),
    methods,
    setAvailable: (value: string) => {
      available = value;
    },
    setCampaign: (s: string | null) => {
      campaign = s;
    },
  };
}
void test("campaign metadata read preserves u64 timestamp and obtains exact u128 money from wrapped views", async () => {
  const f = fixture();
  const c = await f.reader.getCampaign("0");
  assert.ok(c);
  assert.equal(c.title, "Disburse Milestone 3 funding verification");
  assert.equal(c.status, "Approved");
  assert.equal(c.createdAtNs, "1794722173685400100");
  assert.equal(c.accounting.budget, budget);
  assert.equal(c.accounting.funded, "1000000");
  assert.equal(c.accounting.available, "1000000");
  assert.deepEqual(f.methods, [
    "get_campaign",
    "get_campaign_payout_accounting",
    "get_campaign_funding",
    "ft_metadata",
  ]);
});
void test("campaign read rejects ID/status/token mismatch and returns null for absence", async () => {
  for (const changed of [
    metadata.replace('"id":0', '"id":1'),
    metadata.replace('"Approved"', '"Paid"'),
    metadata.replace("usdc.tidepool-sandbox.testnet", "other.testnet"),
  ]) {
    const f = fixture();
    f.setCampaign(changed);
    await assert.rejects(f.reader.getCampaign("0"));
  }
  const f = fixture();
  f.setCampaign(null);
  assert.equal(await f.reader.getCampaign("0"), null);
  assert.deepEqual(f.methods, ["get_campaign"]);
});
void test("restricted campaign endpoint is authenticated and read-only, including after funding", async () => {
  const f = fixture();
  const headers = { authorization: "Bearer read-campaign-test" };
  const server = await startExecutionApiServer(
    {
      reader: f.reader,
      activeTestnetReadOnly: true,
      authorize: (req) => req.headers.authorization === headers.authorization,
    },
    { port: 0, host: "127.0.0.1" },
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/campaigns/0`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const r = await fetch(url, { headers });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control")!, /no-store/);
    const body = (await r.json()) as {
      data: {
        campaign: {
          id: string;
          status: string;
          accounting: { funded: string };
        };
      };
    };
    assert.equal(body.data.campaign.id, "0");
    assert.equal(body.data.campaign.status, "Approved");
    assert.equal(body.data.campaign.accounting.funded, "1000000");
    f.setAvailable("2000000");
    assert.equal((await fetch(url, { headers })).status, 502);
    f.setAvailable("1000000");
    for (const method of ["POST", "PUT", "DELETE"])
      assert.equal((await fetch(url, { method, headers })).status, 403);
    assert.equal(
      (await fetch(url + "/fund", { method: "POST", headers })).status,
      403,
    );
    f.setCampaign(null);
    assert.equal((await fetch(url, { headers })).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
