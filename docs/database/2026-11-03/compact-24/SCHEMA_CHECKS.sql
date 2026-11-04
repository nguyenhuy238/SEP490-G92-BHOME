-- Synthetic database-only schema checks. All fixture rows are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RETURN 1; END $f$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected_state text) RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE<>expected_state THEN RAISE EXCEPTION 'Expected %, got %',expected_state,SQLSTATE; END IF;
        RETURN 1;
    END;
    RAISE EXCEPTION 'Expected rejection did not occur';
END $f$;

SELECT pg_temp.assert_true((SELECT count(*)=24 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),'exactly 24 tables');

INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp) VALUES
('00000000-0000-0000-0000-000000000001','synthetic-owner','SYNTHETIC-OWNER','SYNTHETIC-NONLOGIN-HASH',ARRAY['Owner'],'synthetic-stamp','synthetic-version'),
('00000000-0000-0000-0000-000000000002','synthetic-staff','SYNTHETIC-STAFF','SYNTHETIC-NONLOGIN-HASH',ARRAY['Staff'],'synthetic-stamp','synthetic-version'),
('00000000-0000-0000-0000-000000000003','synthetic-tenant','SYNTHETIC-TENANT','SYNTHETIC-NONLOGIN-HASH',ARRAY['Tenant'],'synthetic-stamp','synthetic-version');
SELECT pg_temp.expect_error($q$INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp) VALUES ('00000000-0000-0000-0000-000000000004','other','OTHER','synthetic',ARRAY['Owner'],'stamp','v')$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE users SET roles=ARRAY['UnexpectedRole'] WHERE id='00000000-0000-0000-0000-000000000002'$q$,'23514');

INSERT INTO refresh_tokens(id,user_id,record_kind,security_stamp,issued_at,expires_at) VALUES
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','SESSION','synthetic-stamp','2026-11-01Z','2026-11-08Z');
SELECT pg_temp.expect_error($q$INSERT INTO refresh_tokens(id,user_id,record_kind,session_id,token_hash,issued_at,expires_at) VALUES ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','TOKEN','10000000-0000-0000-0000-000000000001','synthetic-hash','2026-11-01Z','2026-11-02Z')$q$,'P0001');
SELECT pg_temp.expect_error($q$INSERT INTO refresh_tokens(id,user_id,record_kind,session_id,token_hash,issued_at,expires_at) VALUES ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','TOKEN','10000000-0000-0000-0000-000000000001','synthetic-hash','2026-11-01Z','2026-11-09Z')$q$,'P0001');
INSERT INTO refresh_tokens(id,user_id,record_kind,session_id,token_hash,issued_at,expires_at) VALUES
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','TOKEN','10000000-0000-0000-0000-000000000001','synthetic-hash','2026-11-01Z','2026-11-02Z');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM refresh_tokens),'session and token in one physical table');

INSERT INTO locations(id,name,address) VALUES ('20000000-0000-0000-0000-000000000001','Synthetic L1','Synthetic address'),('20000000-0000-0000-0000-000000000002','Synthetic L2','Synthetic address');
INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','R1',2,0);
SELECT pg_temp.expect_error($q$INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','R1',2,0)$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE rooms SET capacity=0 WHERE id='30000000-0000-0000-0000-000000000001'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO assets(id,location_id,room_id,name,category,condition,status) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Synthetic asset','SYNTHETIC','NEW',0)$q$,'23503');
SELECT pg_temp.expect_error($q$INSERT INTO assets(id,location_id,name,category,condition,status) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic asset','SYNTHETIC','NEW',0)$q$,'23514');
UPDATE locations SET history='[{"action":"synthetic-first"}]' WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE locations SET history=history||'[{"action":"synthetic-second"}]'::jsonb WHERE id='20000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT jsonb_array_length(history)=2 FROM locations WHERE id='20000000-0000-0000-0000-000000000001'),'history append works');
SELECT pg_temp.expect_error($q$UPDATE locations SET history='[]' WHERE id='20000000-0000-0000-0000-000000000001'$q$,'P0001');

INSERT INTO residents(id,user_id,current_room_id,identity_owner_scope_id,display_label,verification_status) VALUES
('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic occupant',0);
INSERT INTO contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,start_date,end_date,monthly_rent,deposit_required,terms,status) VALUES
('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','MAIN','2026-11-01','2027-11-01',100000,0,'Synthetic schema test only',0);
SELECT pg_temp.expect_error($q$UPDATE contracts SET status=3 WHERE id='60000000-0000-0000-0000-000000000001'$q$,'23514');

INSERT INTO meters(id,room_id,utility_type,meter_code,display_type,decimal_places,installed_on,is_active) VALUES
('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'SYNTHETIC-M1',0,0,'2026-11-01',true);
SELECT pg_temp.expect_error($q$INSERT INTO meters(id,room_id,utility_type,meter_code,display_type,decimal_places,installed_on,is_active) VALUES ('70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',0,'SYNTHETIC-M2',0,0,'2026-11-01',true)$q$,'23505');
INSERT INTO operational_tasks(id,task_type,source_key,status,task_data) VALUES ('80000000-0000-0000-0000-000000000001','SYSTEM_JOB','synthetic-job:2026-11','Pending','{}');
SELECT pg_temp.expect_error($q$INSERT INTO operational_tasks(id,task_type,source_key,status) VALUES ('80000000-0000-0000-0000-000000000002','SYSTEM_JOB','synthetic-job:2026-11','Pending')$q$,'23505');
SELECT pg_temp.expect_error($q$INSERT INTO operational_tasks(id,task_type,status) VALUES ('80000000-0000-0000-0000-000000000002','GENERAL','Assigned')$q$,'23514');

INSERT INTO invoices(id,location_id,room_id,contract_id,representative_tenant_user_id,billing_period,recipient_user_ids,base_total_amount,status,billing_snapshot,scheduled_final_date,due_date) VALUES
('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','2026-11-01',ARRAY['00000000-0000-0000-0000-000000000003']::uuid[],100000,0,'{}','2026-11-25','2026-11-30');
INSERT INTO invoice_items(id,invoice_id,charge_code,description,quantity,unit_price,amount,calculation_snapshot) VALUES
('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','RENT','Synthetic rent',1,100000,100000,'{}');
SELECT pg_temp.expect_error($q$INSERT INTO invoices(id,location_id,room_id,contract_id,representative_tenant_user_id,billing_period,recipient_user_ids,base_total_amount,status,billing_snapshot,scheduled_final_date,due_date) SELECT '90000000-0000-0000-0000-000000000002',location_id,room_id,contract_id,representative_tenant_user_id,billing_period,recipient_user_ids,base_total_amount,status,billing_snapshot,scheduled_final_date,due_date FROM invoices$q$,'23505');
UPDATE invoices SET status=1,finalized_at=now(),finalized_by_user_id='00000000-0000-0000-0000-000000000001' WHERE id='90000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$UPDATE invoices SET base_total_amount=1 WHERE id='90000000-0000-0000-0000-000000000001'$q$,'P0001');
SELECT pg_temp.expect_error($q$UPDATE invoice_items SET amount=1 WHERE id='91000000-0000-0000-0000-000000000001'$q$,'P0001');
SELECT pg_temp.expect_error($q$UPDATE invoices SET recipient_user_ids=ARRAY['00000000-0000-0000-0000-000000000002']::uuid[] WHERE id='90000000-0000-0000-0000-000000000001'$q$,'P0001');

INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,received_at,amount,currency,status) VALUES
('a0000000-0000-0000-0000-000000000001','SYNTHETIC','SYNTHETIC-ACCOUNT','SYNTHETIC-REF',now(),100000,'VND','PENDING');
SELECT pg_temp.expect_error($q$INSERT INTO payment_allocations(id,source_payment_id,target_invoice_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason) VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',100000,'b1000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000001',now(),'synthetic')$q$,'P0001');
UPDATE payments SET status='VERIFIED',verification_method='MANUAL',effect_key='SYNTHETIC-EFFECT',verified_by_user_id='00000000-0000-0000-0000-000000000001',verified_at=now() WHERE id='a0000000-0000-0000-0000-000000000001';
INSERT INTO payment_allocations(id,source_payment_id,target_invoice_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason) VALUES
('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',100000,'b1000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000001',now(),'synthetic');
SELECT pg_temp.expect_error($q$UPDATE payment_allocations SET amount=1 WHERE id='b0000000-0000-0000-0000-000000000001'$q$,'P0001');
SELECT pg_temp.expect_error($q$UPDATE payments SET amount=1 WHERE id='a0000000-0000-0000-0000-000000000001'$q$,'P0001');
SELECT pg_temp.expect_error($q$INSERT INTO payment_allocations(id,source_payment_id,target_invoice_id,amount,reversal_of_allocation_id,operation_key,line_number,created_by_user_id,allocated_at,reason) VALUES ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',-1,'b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002',1,'00000000-0000-0000-0000-000000000001',now(),'synthetic')$q$,'P0001');

INSERT INTO notifications(id,record_kind,event_key,notification_type,event_at) VALUES ('c0000000-0000-0000-0000-000000000001','AUDIT','synthetic-audit','SyntheticAudit',now());
SELECT pg_temp.expect_error($q$UPDATE notifications SET event_data='{"changed":true}' WHERE id='c0000000-0000-0000-0000-000000000001'$q$,'P0001');
SELECT pg_temp.expect_error($q$DELETE FROM notifications WHERE id='c0000000-0000-0000-0000-000000000001'$q$,'P0001');
INSERT INTO notifications(id,record_kind,recipient_user_id,event_key,notification_type,event_at) VALUES ('c0000000-0000-0000-0000-000000000002','INBOX','00000000-0000-0000-0000-000000000003','synthetic-inbox','SyntheticNotice',now());
SELECT pg_temp.expect_error($q$INSERT INTO notifications(id,record_kind,recipient_user_id,event_key,notification_type,event_at) VALUES ('c0000000-0000-0000-0000-000000000003','INBOX','00000000-0000-0000-0000-000000000003','synthetic-inbox','SyntheticNotice',now())$q$,'23505');
SELECT pg_temp.expect_error('TRUNCATE notifications','P0001');
ROLLBACK;
