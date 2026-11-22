-- ============================================================================
-- POS مدقق — الملف 2: مخزن الحالة (الحفظ الذرّي لبيانات التطبيق)
-- يُلصق كاملًا في Supabase ← SQL Editor ثم Run. آمن لإعادة التشغيل.
-- الفكرة: كل سجل في التطبيق يُحفظ كمستند JSON، وكل عملية تُكتب تغييراتها
-- دفعة واحدة: إمّا تُحفظ كلها أو لا يُحفظ شيء.
-- ============================================================================

create table if not exists app_documents (
  tenant_id  text not null,
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, collection, id)
);

-- رقم إصدار لكل شركة: يزيد مع كل حفظ، ويمنع سيرفرين من الكتابة فوق بعض
create table if not exists app_state_meta (
  tenant_id   text primary key,
  generation  bigint not null default 0,
  last_writer text,
  updated_at  timestamptz not null default now()
);

-- منطقة تجهيز للعمليات الكبيرة (مثل استيراد آلاف الأصناف) قبل اعتمادها مرة واحدة
create table if not exists app_persist_staging (
  tx_id      uuid not null,
  seq        bigint generated always as identity,
  tenant_id  text not null,
  op         text not null check (op in ('upsert','delete')),
  collection text not null,
  id         text not null,
  data       jsonb,
  created_at timestamptz not null default now(),
  primary key (tx_id, seq)
);
create index if not exists app_persist_staging_created on app_persist_staging (created_at);

alter table app_documents enable row level security;
alter table app_state_meta enable row level security;
alter table app_persist_staging enable row level security;

-- قراءة رقم الإصدار الحالي (ينشئ السطر لو غير موجود)
create or replace function app_get_generation(p_tenant text)
returns bigint
language plpgsql
set search_path = public
as $$
declare g bigint;
begin
  if coalesce(trim(p_tenant), '') = '' then
    raise exception 'TENANT_REQUIRED';
  end if;
  insert into app_state_meta (tenant_id) values (p_tenant) on conflict do nothing;
  select generation into g from app_state_meta where tenant_id = p_tenant;
  return g;
end $$;

-- دالة داخلية: قفل سطر الشركة والتحقق من رقم الإصدار
create or replace function app__lock_and_check(p_tenant text, p_expected_generation bigint)
returns bigint
language plpgsql
set search_path = public
as $$
declare g bigint;
begin
  if coalesce(trim(p_tenant), '') = '' then
    raise exception 'TENANT_REQUIRED';
  end if;
  insert into app_state_meta (tenant_id) values (p_tenant) on conflict do nothing;
  select generation into g from app_state_meta where tenant_id = p_tenant for update;
  if g is distinct from p_expected_generation then
    raise exception 'STATE_CONFLICT'
      using detail = format('expected=%s actual=%s', p_expected_generation, g),
            errcode = 'P0001';
  end if;
  return g;
end $$;

-- حفظ مباشر لعملية صغيرة: كل التغييرات في معاملة واحدة
create or replace function app_persist_changes(
  p_tenant text,
  p_expected_generation bigint,
  p_upserts jsonb default '[]'::jsonb,
  p_deletes jsonb default '[]'::jsonb,
  p_writer text default null
) returns bigint
language plpgsql
set search_path = public
as $$
declare g bigint;
begin
  g := app__lock_and_check(p_tenant, p_expected_generation);

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) e
    where coalesce(e->>'collection','') = '' or coalesce(e->>'id','') = '' or e->'data' is null or jsonb_typeof(e->'data') = 'null'
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_deletes, '[]'::jsonb)) e
    where coalesce(e->>'collection','') = '' or coalesce(e->>'id','') = ''
  ) then
    raise exception 'INVALID_CHANGE_ROW';
  end if;

  insert into app_documents (tenant_id, collection, id, data, updated_at)
  select p_tenant, x.collection, x.id, x.data, now()
  from (
    select distinct on (e.value->>'collection', e.value->>'id')
           e.value->>'collection' as collection, e.value->>'id' as id, e.value->'data' as data
    from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) with ordinality as e(value, ord)
    order by e.value->>'collection', e.value->>'id', e.ord desc
  ) x
  on conflict (tenant_id, collection, id)
  do update set data = excluded.data, updated_at = now();

  delete from app_documents d
  using jsonb_array_elements(coalesce(p_deletes, '[]'::jsonb)) e
  where d.tenant_id = p_tenant
    and d.collection = e->>'collection'
    and d.id = e->>'id';

  update app_state_meta
     set generation = g + 1, last_writer = p_writer, updated_at = now()
   where tenant_id = p_tenant;
  return g + 1;
end $$;

-- تجهيز جزء من عملية كبيرة (يُنادى عدة مرات بنفس tx_id)
create or replace function app_persist_stage(
  p_tx uuid,
  p_tenant text,
  p_upserts jsonb default '[]'::jsonb,
  p_deletes jsonb default '[]'::jsonb
) returns integer
language plpgsql
set search_path = public
as $$
declare n integer := 0; m integer := 0;
begin
  if p_tx is null or coalesce(trim(p_tenant), '') = '' then
    raise exception 'TENANT_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) e
    where coalesce(e->>'collection','') = '' or coalesce(e->>'id','') = '' or e->'data' is null or jsonb_typeof(e->'data') = 'null'
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_deletes, '[]'::jsonb)) e
    where coalesce(e->>'collection','') = '' or coalesce(e->>'id','') = ''
  ) then
    raise exception 'INVALID_CHANGE_ROW';
  end if;

  insert into app_persist_staging (tx_id, tenant_id, op, collection, id, data)
  select p_tx, p_tenant, 'upsert', e.value->>'collection', e.value->>'id', e.value->'data'
  from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) with ordinality as e(value, ord)
  order by e.ord;
  get diagnostics n = row_count;

  insert into app_persist_staging (tx_id, tenant_id, op, collection, id, data)
  select p_tx, p_tenant, 'delete', e.value->>'collection', e.value->>'id', null
  from jsonb_array_elements(coalesce(p_deletes, '[]'::jsonb)) with ordinality as e(value, ord)
  order by e.ord;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- اعتماد العملية الكبيرة: كل ما تم تجهيزه يُطبَّق في معاملة واحدة
create or replace function app_persist_commit(
  p_tx uuid,
  p_tenant text,
  p_expected_generation bigint,
  p_writer text default null
) returns bigint
language plpgsql
set search_path = public
as $$
declare g bigint;
begin
  g := app__lock_and_check(p_tenant, p_expected_generation);

  -- آخر إجراء لكل مستند هو النافذ
  insert into app_documents (tenant_id, collection, id, data, updated_at)
  select p_tenant, f.collection, f.id, f.data, now()
  from (
    select distinct on (s.collection, s.id) s.op, s.collection, s.id, s.data
    from app_persist_staging s
    where s.tx_id = p_tx and s.tenant_id = p_tenant
    order by s.collection, s.id, s.seq desc
  ) f
  where f.op = 'upsert'
  on conflict (tenant_id, collection, id)
  do update set data = excluded.data, updated_at = now();

  delete from app_documents d
  using (
    select distinct on (s.collection, s.id) s.op, s.collection, s.id
    from app_persist_staging s
    where s.tx_id = p_tx and s.tenant_id = p_tenant
    order by s.collection, s.id, s.seq desc
  ) f
  where f.op = 'delete' and d.tenant_id = p_tenant
    and d.collection = f.collection and d.id = f.id;

  delete from app_persist_staging where tx_id = p_tx;
  delete from app_persist_staging where created_at < now() - interval '1 day';

  update app_state_meta
     set generation = g + 1, last_writer = p_writer, updated_at = now()
   where tenant_id = p_tenant;
  return g + 1;
end $$;

-- إلغاء عملية مجهّزة لم تُعتمد
create or replace function app_persist_abort(p_tx uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  delete from app_persist_staging where tx_id = p_tx;
  get diagnostics n = row_count;
  return n;
end $$;

-- تحميل الحالة على صفحات (ترتيب ثابت بالمجموعة ثم المعرّف)
create or replace function app_load_page(
  p_tenant text,
  p_after_collection text default '',
  p_after_id text default '',
  p_limit integer default 1000
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare result jsonb; g bigint; lim integer;
begin
  if coalesce(trim(p_tenant), '') = '' then
    raise exception 'TENANT_REQUIRED';
  end if;
  lim := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  select generation into g from app_state_meta where tenant_id = p_tenant;
  select coalesce(jsonb_agg(jsonb_build_object('collection', q.collection, 'id', q.id, 'data', q.data)
                            order by q.collection, q.id), '[]'::jsonb)
    into result
  from (
    select d.collection, d.id, d.data
    from app_documents d
    where d.tenant_id = p_tenant
      and (d.collection, d.id) > (coalesce(p_after_collection, ''), coalesce(p_after_id, ''))
    order by d.collection, d.id
    limit lim
  ) q;
  return jsonb_build_object(
    'generation', coalesce(g, 0),
    'count', jsonb_array_length(result),
    'rows', result
  );
end $$;

-- مسح بيانات شركة تجريبية فقط (اسمها يبدأ بـ test_ أو dev) — للاختبارات
create or replace function app_reset_test_tenant(p_tenant text)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  if p_tenant is null or not (p_tenant like 'test\_%' or p_tenant like 'dev%') then
    raise exception 'ONLY_TEST_TENANTS_CAN_BE_RESET';
  end if;
  delete from app_documents where tenant_id = p_tenant;
  get diagnostics n = row_count;
  delete from app_persist_staging where tenant_id = p_tenant;
  delete from app_state_meta where tenant_id = p_tenant;
  return n;
end $$;

-- الصلاحيات: السيرفر فقط
revoke all on table app_documents, app_state_meta, app_persist_staging from public, anon, authenticated;
grant select, insert, update, delete on table app_documents, app_state_meta, app_persist_staging to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function
  app_get_generation(text),
  app__lock_and_check(text, bigint),
  app_persist_changes(text, bigint, jsonb, jsonb, text),
  app_persist_stage(uuid, text, jsonb, jsonb),
  app_persist_commit(uuid, text, bigint, text),
  app_persist_abort(uuid),
  app_load_page(text, text, text, integer),
  app_reset_test_tenant(text)
from public, anon, authenticated;

grant execute on function
  app_get_generation(text),
  app__lock_and_check(text, bigint),
  app_persist_changes(text, bigint, jsonb, jsonb, text),
  app_persist_stage(uuid, text, jsonb, jsonb),
  app_persist_commit(uuid, text, bigint, text),
  app_persist_abort(uuid),
  app_load_page(text, text, text, integer),
  app_reset_test_tenant(text)
to service_role;

-- مهلة أطول لعمليات السيرفر الكبيرة (مثل استيراد آلاف الأصناف)
do $$
begin
  execute 'alter role service_role set statement_timeout = ''60s''';
exception when others then
  raise notice 'تعذر ضبط المهلة (غير مؤثر على التشغيل): %', sqlerrm;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- نتيجة التحقق: المفروض 8
select count(*) as functions_created
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app\_%';
