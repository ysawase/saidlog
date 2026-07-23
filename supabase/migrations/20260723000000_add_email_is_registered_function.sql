-- auth.usersを直接照会し、メールアドレスの登録有無を確認するための関数。
-- クライアントから直接呼べないよう、service_roleのみに実行権限を付与する。

create or replace function public.email_is_registered(check_email text)
returns boolean
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  return exists (
    select 1 from auth.users
    where lower(email) = lower(check_email)
  );
end;
$$;

revoke all on function public.email_is_registered(text) from public;
revoke execute on function public.email_is_registered(text) from anon, authenticated;
grant execute on function public.email_is_registered(text) to service_role;
