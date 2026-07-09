-- =====================================================================
-- Supabase: RPC function untuk migrasi legacy user ke auth.users
-- =====================================================================
-- Jalankan SEKALI di Supabase SQL Editor (Dashboard → SQL → New query).
--
-- Function ini INSERT satu user ke auth.users Supabase dengan password hash
-- bcrypt yang sudah ada ($2a$/$2b$) — sehingga user login pakai password lama
-- TANPA reset. GoTrue verifikasi bcrypt dengan membaca cost dari prefix hash.
--
-- Kenapa RPC, bukan insert langsung dari script Node?
--  - PostgREST (yang dipakai supabase-js .from()) tidak expose schema `auth`
--    by default (security). RPC function berjalan sebagai `postgres` (auth
--    definer) → bisa akses auth.users.
--  - Parameter ter-bind → anti SQL injection.
--
-- Usage dari script Node:
--   supabase.rpc('migrate_legacy_user', {
--     p_email, p_encrypted_password, p_legacy_user_id, p_referral_code
--   })
-- =====================================================================

create or replace function public.migrate_legacy_user(
  p_email text,
  p_encrypted_password text,
  p_legacy_user_id text,
  p_referral_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing uuid;
  v_new_id uuid;
begin
  -- Cek apakah email sudah ada (idempotent).
  select id into v_existing from auth.users where email = lower(p_email) limit 1;
  if found then
    return v_existing;
  end if;

  -- Generate UUID baru + insert ke auth.users.
  v_new_id := gen_random_uuid();

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_sso_user,
    deleted_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_new_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    p_encrypted_password,           -- bcrypt hash lama ($2a$/$2b$) — dipakai apa adanya
    now(),                           -- email_confirmed_at: user lama sudah verified
    now(),                           -- invited_at
    '',                              -- confirmation_token (kosong = tidak butuh konfirmasi)
    '',                              -- recovery_token
    '',                              -- email_change_token_new
    '',                              -- email_change
    now(),                           -- created_at
    now(),                           -- updated_at
    '{}'::jsonb,                     -- raw_app_meta_data
    jsonb_build_object(              -- raw_user_meta_data: simpan legacy id untuk audit
      'legacyUserId', p_legacy_user_id,
      'referralCode', p_referral_code,
      'migratedAt', now()
    ),
    false,                           -- is_sso_user
    null                             -- deleted_at
  );

  -- Catat identitas (auth.identities) — wajib agar GoTrue recognize user.
  insert into auth.identities (
    id,
    user_id,
    identity_data,
    identity_id,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_new_id,
    jsonb_build_object('sub', v_new_id::text, 'email', lower(p_email)),
    v_new_id::text,
    'email',
    now(),
    now(),
    now()
  );

  return v_new_id;
end;
$$;

-- Restrict execution: hanya role yang dipakai service_role/anon boleh panggil.
-- service_role otomatis bypass, tapi kita revoke dari anon supaya tidak callable
-- dari browser.
revoke execute on function public.migrate_legacy_user(text, text, text, text) from anon, authenticated;
grant execute on function public.migrate_legacy_user(text, text, text, text) to service_role;
