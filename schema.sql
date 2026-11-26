-- ألو بوطة: قاعدة البيانات الآمنة (Supabase / PostgreSQL)
-- الصقه كاملاً في Supabase > SQL Editor ثم اضغط Run مرة واحدة.
-- كل تعديل على الطلبات والأرصدة يمر عبر دوال على الخادم، ولا يستطيع التطبيق كتابتها مباشرة.

-- ============ الجداول ============

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','youth','admin')),
  name text not null,
  phone text not null,
  hood text not null,
  address text,
  status text not null default 'approved' check (status in ('pending','approved','suspended')),
  wallet numeric(10,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  commission_pct numeric(5,2) not null default 10 check (commission_pct between 0 and 50),
  bottle_price numeric(10,2) not null default 50 check (bottle_price > 0),
  min_fee numeric(10,2) not null default 10 check (min_fee >= 0)
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  customer_name text not null,
  hood text not null,
  floor int not null check (floor between 0 and 15),
  fee numeric(10,2) not null check (fee >= 0),
  bottle_price numeric(10,2) not null,
  commission_pct numeric(5,2) not null,
  status text not null default 'new' check (status in ('new','accepted','picked','delivered','cancelled')),
  youth_id uuid references public.profiles(id),
  youth_name text,
  commission numeric(10,2),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_youth_idx on public.orders(youth_id);

-- هاتف وعنوان الزبون لا يظهران للشباب إلا بعد قبول الطلب
create table if not exists public.order_contacts (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_phone text not null,
  address text not null,
  youth_phone text
);

create table if not exists public.wallet_tx (
  id bigint generated always as identity primary key,
  youth_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  amount numeric(10,2) not null,
  kind text not null check (kind in ('topup','accept_hold','release','commission','refund')),
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_youth_idx on public.wallet_tx(youth_id);

-- ============ دوال مساعدة ============

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_approved_youth() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'youth' and status = 'approved');
$$;

-- ============ صلاحيات الصفوف (RLS) ============

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_contacts enable row level security;
alter table public.wallet_tx enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (
    customer_id = auth.uid()
    or youth_id = auth.uid()
    or public.is_admin()
    or (status = 'new' and public.is_approved_youth())
  );

drop policy if exists contacts_read on public.order_contacts;
create policy contacts_read on public.order_contacts for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_id and (o.customer_id = auth.uid() or o.youth_id = auth.uid()))
  );

drop policy if exists tx_read on public.wallet_tx;
create policy tx_read on public.wallet_tx for select to authenticated
  using (youth_id = auth.uid() or public.is_admin());

-- لا كتابة مباشرة من التطبيق: القراءة فقط، والكتابة عبر الدوال أدناه
revoke all on public.profiles, public.settings, public.orders, public.order_contacts, public.wallet_tx from anon, authenticated;
grant select on public.profiles, public.settings, public.orders, public.order_contacts, public.wallet_tx to authenticated;

-- ============ التسجيل ============

create or replace function public.register_customer(p_name text, p_phone text, p_hood text, p_address text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  p_name := btrim(p_name); p_phone := btrim(p_phone); p_hood := btrim(p_hood); p_address := btrim(p_address);
  if length(p_name) not between 2 and 60 or length(p_hood) not between 2 and 60
     or length(p_address) not between 3 and 120 or p_phone !~ '^[0-9+ ]{8,15}$' then
    raise exception 'invalid_input';
  end if;
  select role into cur from public.profiles where id = uid;
  if cur is null then
    insert into public.profiles (id, role, name, phone, hood, address) values (uid, 'customer', p_name, p_phone, p_hood, p_address);
  elsif cur = 'customer' then
    update public.profiles set name = p_name, phone = p_phone, hood = p_hood, address = p_address where id = uid;
  else
    raise exception 'already_registered';
  end if;
end $$;

create or replace function public.register_youth(p_name text, p_phone text, p_hood text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  p_name := btrim(p_name); p_phone := btrim(p_phone); p_hood := btrim(p_hood);
  if length(p_name) not between 2 and 60 or length(p_hood) not between 2 and 60 or p_phone !~ '^[0-9+ ]{8,15}$' then
    raise exception 'invalid_input';
  end if;
  select role into cur from public.profiles where id = uid;
  if cur is null then
    insert into public.profiles (id, role, name, phone, hood, status) values (uid, 'youth', p_name, p_phone, p_hood, 'pending');
  elsif cur = 'youth' then
    update public.profiles set name = p_name, phone = p_phone, hood = p_hood where id = uid;
  else
    raise exception 'already_registered';
  end if;
end $$;

-- ============ الطلبات ============

create or replace function public.create_order(p_floor int, p_fee numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; s public.settings; oid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into me from public.profiles where id = uid;
  if me.id is null or me.role <> 'customer' then raise exception 'not_a_customer'; end if;
  select * into s from public.settings where id = 1;
  if p_floor is null or p_floor not between 0 and 15 then raise exception 'invalid_input'; end if;
  if p_fee is null or p_fee < s.min_fee or p_fee > 200 then raise exception 'invalid_fee'; end if;
  if exists (select 1 from public.orders where customer_id = uid and status in ('new','accepted','picked')) then
    raise exception 'active_order_exists';
  end if;
  insert into public.orders (customer_id, customer_name, hood, floor, fee, bottle_price, commission_pct)
    values (uid, me.name, me.hood, p_floor, round(p_fee, 2), s.bottle_price, s.commission_pct)
    returning id into oid;
  insert into public.order_contacts (order_id, customer_phone, address) values (oid, me.phone, me.address);
  return oid;
end $$;

create or replace function public.accept_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; o public.orders;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into me from public.profiles where id = uid for update;
  if me.id is null or me.role <> 'youth' or me.status <> 'approved' then raise exception 'not_approved_youth'; end if;
  if not me.active then raise exception 'not_available'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status <> 'new' then raise exception 'order_taken'; end if;
  if exists (select 1 from public.orders where youth_id = uid and status in ('accepted','picked')) then
    raise exception 'finish_current_job';
  end if;
  if me.wallet < o.bottle_price then raise exception 'low_wallet'; end if;
  update public.orders set status = 'accepted', youth_id = uid, youth_name = me.name, accepted_at = now() where id = o.id;
  update public.order_contacts set youth_phone = me.phone where order_id = o.id;
  update public.profiles set wallet = wallet - o.bottle_price where id = uid;
  insert into public.wallet_tx (youth_id, order_id, amount, kind) values (uid, o.id, -o.bottle_price, 'accept_hold');
end $$;

create or replace function public.pick_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  update public.orders set status = 'picked', picked_at = now()
   where id = p_order and youth_id = uid and status = 'accepted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'invalid_state'; end if;
end $$;

create or replace function public.deliver_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o public.orders; comm numeric(10,2);
begin
  select * into o from public.orders where id = p_order and youth_id = uid for update;
  if o.id is null or o.status <> 'picked' then raise exception 'invalid_state'; end if;
  comm := round(o.fee * o.commission_pct / 100, 2);
  update public.orders set status = 'delivered', delivered_at = now(), commission = comm where id = o.id;
  update public.profiles set wallet = wallet + o.bottle_price - comm where id = uid;
  insert into public.wallet_tx (youth_id, order_id, amount, kind) values (uid, o.id, o.bottle_price, 'release');
  if comm > 0 then
    insert into public.wallet_tx (youth_id, order_id, amount, kind) values (uid, o.id, -comm, 'commission');
  end if;
end $$;

create or replace function public.cancel_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o public.orders; adm boolean := public.is_admin();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status not in ('new','accepted','picked') then raise exception 'invalid_state'; end if;
  if not adm and not (o.customer_id = uid and o.status = 'new') then raise exception 'not_allowed'; end if;
  update public.orders set status = 'cancelled', cancelled_at = now() where id = o.id;
  if o.youth_id is not null then
    update public.profiles set wallet = wallet + o.bottle_price where id = o.youth_id;
    insert into public.wallet_tx (youth_id, order_id, amount, kind) values (o.youth_id, o.id, o.bottle_price, 'refund');
  end if;
end $$;

create or replace function public.set_youth_active(p_active boolean)
returns void language sql security definer set search_path = public as $$
  update public.profiles set active = p_active where id = auth.uid() and role = 'youth';
$$;

-- ============ الإدارة ============

create or replace function public.admin_set_youth_status(p_youth uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if p_status not in ('pending','approved','suspended') then raise exception 'invalid_input'; end if;
  update public.profiles set status = p_status where id = p_youth and role = 'youth';
end $$;

create or replace function public.admin_topup(p_youth uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 5000 then raise exception 'invalid_input'; end if;
  update public.profiles set wallet = wallet + p_amount where id = p_youth and role = 'youth' and status = 'approved';
  if not found then raise exception 'invalid_input'; end if;
  insert into public.wallet_tx (youth_id, amount, kind) values (p_youth, p_amount, 'topup');
end $$;

create or replace function public.admin_update_settings(p_pct numeric, p_price numeric, p_min numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  update public.settings set commission_pct = p_pct, bottle_price = p_price, min_fee = p_min where id = 1;
end $$;

-- ============ صلاحيات تنفيذ الدوال ============

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- ============ التحديث الفوري ============

do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_contacts;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when others then null; end $$;

-- ============ تعيين المدير (نفّذه بعد أن تسجل حسابك من التطبيق، وغيّر الرقم) ============
-- update public.profiles set role = 'admin' where phone = '0600000000';
