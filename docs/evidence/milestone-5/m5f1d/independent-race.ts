import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPostgresPool,createPostgresQuery} from '../../../../execution-service/src/persistence/postgres-pool.ts';
import {loadPostgresRuntimeConfig} from '../../../../execution-service/src/persistence/postgres-config.ts';
import {PostgresAuthorizationRepository} from '../../../../execution-service/src/persistence/postgres-security-repositories.ts';
import {makeAuthorizationFixture} from '../../../../execution-service/tests/integration/postgres-fixtures.ts';
const pool=createPostgresPool(loadPostgresRuntimeConfig('test'));
const repo=new PostgresAuthorizationRepository(createPostgresQuery(pool));
const blocker=await pool.connect();
try {
 const id=await pool.query('SELECT current_database() AS db,current_user AS role,inet_server_addr()::text AS host');assert.equal(id.rows[0].db,'disburse_test');assert.equal(id.rows[0].role,'disburse_test');assert.equal(id.rows[0].host,'127.0.0.1/32');
 const fixture=makeAuthorizationFixture(`review-lock-${randomUUID()}`,{ttlMs:2500});
 const created=await repo.create(fixture.authorization);await repo.approve(created.authorizationId,Date.now());
 await blocker.query('BEGIN');await blocker.query('SELECT authorization_id FROM execution_authorizations WHERE authorization_id=$1 FOR UPDATE',[created.authorizationId]);
 const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const consume=repo.consume(created.authorizationId,fixture.request,fixture.policy,fixture.reservation,fixture.quote,Date.now()).then(value=>({accepted:true,lifecycle:value.lifecycle}),error=>({accepted:false,error:String(error)}));
 let blocked=false;const deadline=Date.now()+2000;
 while(Date.now()<deadline){ const q=await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid]);if(q.rows[0].blocked){blocked=true;break;}await pool.query('SELECT pg_sleep(0.01)');}
 assert.ok(blocked,'consume must actually wait on row lock');
 await pool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (authorization_expires_at-clock_timestamp())))+0.3) FROM execution_authorizations WHERE authorization_id=$1",[created.authorizationId]);
 const after=(await blocker.query('SELECT clock_timestamp()>authorization_expires_at AS expired,clock_timestamp() AS released_at,authorization_expires_at FROM execution_authorizations WHERE authorization_id=$1',[created.authorizationId])).rows[0];assert.ok(after.expired);
 await blocker.query('COMMIT');const result=await consume;
 const final=(await pool.query('SELECT lifecycle,consumed_at,authorization_expires_at,clock_timestamp() AS observed_at FROM execution_authorizations WHERE authorization_id=$1',[created.authorizationId])).rows[0];
 assert.equal(result.accepted,false);assert.equal(final.lifecycle,'Expired');assert.equal(final.consumed_at,null);
 console.log(JSON.stringify({test:'actual repository consume after deterministic lock-wait expiry',expected:'reject expired authorization without consumption',blockedOnRow:true,expiredBeforeLockRelease:after,...result,final},null,2));
}finally{await blocker.query('ROLLBACK');blocker.release();await pool.end();}
