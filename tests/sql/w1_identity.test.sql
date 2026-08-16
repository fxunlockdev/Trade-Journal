-- W1 adversarial test suite. Run against the shadow DB.
-- Run BEFORE the migration (expect failures = RED) and AFTER (expect PASS = GREEN).
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

-- T1: platform_role column exists
select 'T1 platform_role column exists: ' ||
  case when exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='users'
                      and column_name='platform_role')
       then 'PASS' else 'FAIL' end;

-- T2: entitlement matrix seeded (6 rows)
select 'T2 matrix rows (expect 6): ' ||
  case when to_regclass('public.role_products') is null then 'FAIL (no table)'
       when (select count(*) from public.role_products) = 6 then 'PASS'
       else 'FAIL' end;

-- T3: has_product matrix correct per tier
do $$
declare aj boolean; ac boolean; ij boolean; ic boolean; ia boolean; ad boolean;
begin
  select public.has_product((select id from public.users where platform_role='affiliate' limit 1),'journal') into aj;
  select public.has_product((select id from public.users where platform_role='affiliate' limit 1),'crm')     into ac;
  select public.has_product((select id from public.users where platform_role='ib' limit 1),'journal')        into ij;
  select public.has_product((select id from public.users where platform_role='ib' limit 1),'crm')            into ic;
  select public.has_product((select id from public.users where platform_role='ib' limit 1),'admin')          into ia;
  select public.has_product((select id from public.users where platform_role='admin' limit 1),'crm')         into ad;
  raise notice 'T3 entitlement matrix: %',
    case when aj and not ac and ij and ic and not ia and ad then 'PASS'
         else 'FAIL (affJ='||aj||' affC='||ac||' ibJ='||ij||' ibC='||ic||' ibA='||ia||' admC='||ad||')' end;
exception when others then raise notice 'T3 entitlement matrix: FAIL (%)', sqlerrm;
end $$;

-- T4 (I5): demotion cuts CRM access immediately at the data layer
do $$
declare v_id uuid; b boolean; a boolean;
begin
  select id into v_id from public.users where platform_role='ib' limit 1;
  b := public.has_product(v_id,'crm');
  update public.users set platform_role='affiliate' where id=v_id;
  a := public.has_product(v_id,'crm');
  raise notice 'T4 demotion cuts crm instantly: %', case when b and not a then 'PASS' else 'FAIL' end;
  update public.users set platform_role='ib' where id=v_id;
exception when others then raise notice 'T4 demotion cuts crm instantly: FAIL (%)', sqlerrm;
end $$;

-- T5 (P0/I6): authenticated cannot self-assign platform_role
do $$
declare v_id uuid;
begin
  select id into v_id from public.users where platform_role='affiliate' limit 1;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    execute format('update public.users set platform_role=''admin'' where id=%L', v_id);
    reset role;
    raise notice 'T5 self-assign platform_role blocked: FAIL (update succeeded)';
  exception when insufficient_privilege then
    reset role; raise notice 'T5 self-assign platform_role blocked: PASS (permission denied)';
  when others then
    reset role; raise notice 'T5 self-assign platform_role blocked: PASS (%)', sqlerrm;
  end;
exception when others then raise notice 'T5: FAIL setup (%)', sqlerrm;
end $$;

-- T6: has_product hardening
select 'T6a has_product is SECURITY DEFINER: ' ||
  case when coalesce((select prosecdef from pg_proc where proname='has_product' limit 1),false)
       then 'PASS' else 'FAIL' end;
select 'T6b has_product pins search_path: ' ||
  case when exists (select 1 from pg_proc where proname='has_product'
                      and array_to_string(proconfig,',') like '%search_path=%')
       then 'PASS' else 'FAIL' end;
select 'T6c has_product NOT executable by anon: ' ||
  case when to_regprocedure('public.has_product(uuid,text)') is null then 'FAIL (no fn)'
       when not has_function_privilege('anon','public.has_product(uuid,text)','execute')
       then 'PASS' else 'FAIL' end;

-- T7: new signup defaults to affiliate
do $$
declare v_role text;
begin
  insert into auth.users (id,email,raw_user_meta_data)
  values ('99999999-9999-9999-9999-999999999999','w1signup@test.com','{"full_name":"W1"}'::jsonb)
  on conflict (id) do nothing;
  select platform_role::text into v_role from public.users where id='99999999-9999-9999-9999-999999999999';
  raise notice 'T7 new signup defaults to affiliate: %', case when v_role='affiliate' then 'PASS' else 'FAIL ('||coalesce(v_role,'no column/row')||')' end;
exception when others then raise notice 'T7 new signup defaults to affiliate: FAIL (%)', sqlerrm;
end $$;

-- T8 (I6): hostile signup metadata cannot set role/platform_role
do $$
declare v_pr text; v_r text;
begin
  insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
  values ('88888888-8888-8888-8888-888888888888','hostile@test.com',
          '{"full_name":"Hostile","role":"admin","platform_role":"admin"}'::jsonb,
          '{"platform_role":"admin"}'::jsonb)
  on conflict (id) do nothing;
  select platform_role::text, role into v_pr, v_r from public.users where id='88888888-8888-8888-8888-888888888888';
  raise notice 'T8 hostile signup metadata ignored: %',
    case when v_pr='affiliate' and v_r is distinct from 'admin' then 'PASS'
         else 'FAIL (platform_role='||coalesce(v_pr,'?')||', role='||coalesce(v_r,'?')||')' end;
exception when others then raise notice 'T8 hostile signup metadata ignored: FAIL (%)', sqlerrm;
end $$;

-- T9: JWT claim mirrors platform_role
do $$
declare v_claim text;
begin
  select raw_app_meta_data->>'platform_role' into v_claim
    from auth.users where id=(select id from public.users where platform_role='ib' limit 1);
  raise notice 'T9 app_metadata claim synced for ib: %', case when v_claim='ib' then 'PASS' else 'FAIL ('||coalesce(v_claim,'null')||')' end;
exception when others then raise notice 'T9 app_metadata claim synced: FAIL (%)', sqlerrm;
end $$;

-- T10 (I7): every public table has RLS + >=1 policy
select 'T10 RLS+policy on every public table: ' ||
  case when count(*)=0 then 'PASS' else 'FAIL: ' || string_agg(relname, ', ') end
from (
  select c.relname
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname))
) gaps;
