-- A deletion is recorded while the trade still exists.
--
-- The audit trigger fired AFTER DELETE and inserted a row pointing at a trade
-- that was already gone, so trade_audit_log_trade_id_fkey refused it and no
-- trade could be deleted at all: 627 audit rows, zero deletions, and Pierre
-- the first to try. Inserts and updates stay AFTER, reading the final row;
-- the delete record moves BEFORE, and the existing ON DELETE SET NULL then
-- clears the link while before_data keeps the whole trade.
--
-- The audit table and its function were created outside this repository, so
-- everything here is conditional: a database without them is left alone.
do $$
begin
  if to_regclass('public.trade_audit_log') is null
     or to_regprocedure('public.log_trade_change()') is null then
    return;
  end if;
  drop trigger if exists log_trade_change on public.trades;
  create trigger log_trade_change
    after insert or update on public.trades
    for each row execute function public.log_trade_change();
  drop trigger if exists log_trade_delete on public.trades;
  create trigger log_trade_delete
    before delete on public.trades
    for each row execute function public.log_trade_change();
end $$;
