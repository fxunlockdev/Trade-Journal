-- 20260826120000_pnl_currency.sql
-- Give every P&L figure a unit.
--
-- `trades.pnl_absolute` is a bare number, and three write paths disagree about
-- what it means:
--   manual / AI chat  -> converted toward USD by accountCurrencyFactor
--   broker rows       -> the broker's own figure, in ITS deposit currency,
--                        deliberately unconverted (lib/mt5/ingest.ts)
--   unknown quote ccy -> quoteToUsdFactor returns a factor of 1, so the figure
--                        silently stays in the QUOTE currency
--
-- Nothing recorded which. That is why the account-balance card refuses EUR and
-- GBP journals outright, why money cannot be combined across journals, and why
-- a EUR-deposit account stores euros in a column every reader treats as USD.
--
-- THE POINT OF THIS MIGRATION: it converts nothing and changes no displayed
-- number. It makes the ambiguity RECORDED instead of inferred, which is the
-- precondition for real FX rates and a reporting currency. Every day without
-- it is another day of rows whose currency has to be guessed after the fact.
--
-- Two columns, because one cannot tell the truth. `pnl_currency` alone would
-- stamp 'USD' on figures derived from a hardcoded EUR=1.08 mid-rate and call
-- them dollars; they are dollars-ISH. `pnl_rate_quality` records the difference
-- between knowing and assuming, and becomes the worklist when real rates land.
--
-- Additive and reversible. Existing rows keep NULL, which reads as "written
-- before this existed" — deliberately distinct from 'assumed'.

begin;

alter table public.trades
  add column if not exists pnl_currency text,
  add column if not exists pnl_rate_quality text;

-- ISO 4217: three uppercase letters. NOT the journals.account_currency domain,
-- which is CHECK-limited to USD/EUR/GBP — a broker deposit currency can be any
-- code, and constraining it to three would force a lie for the rest.
alter table public.trades
  drop constraint if exists trades_pnl_currency_iso;
alter table public.trades
  add constraint trades_pnl_currency_iso
  check (pnl_currency is null or pnl_currency ~ '^[A-Z]{3}$');

alter table public.trades
  drop constraint if exists trades_pnl_rate_quality_allowed;
alter table public.trades
  add constraint trades_pnl_rate_quality_allowed
  check (
    pnl_rate_quality is null
    or pnl_rate_quality in ('broker', 'exact', 'approximate', 'assumed')
  );

-- Finding the rows worth re-valuing once real rates exist is the whole reason
-- the quality column is here, so make that lookup cheap. Partial: the vast
-- majority of rows are 'exact' or 'broker' and never need visiting.
create index if not exists trades_pnl_rate_quality_idx
  on public.trades (pnl_rate_quality)
  where pnl_rate_quality in ('approximate', 'assumed');

comment on column public.trades.pnl_currency is
  'ISO 4217 code that pnl_absolute is denominated in. NULL = written before '
  'this column existed; the currency must be inferred, not trusted.';
comment on column public.trades.pnl_rate_quality is
  'How the denomination is known: broker (the broker''s own figure, exact by '
  'definition), exact (USD-quoted, or an indirect quote converted at 1/price), '
  'approximate (a cross converted with a hardcoded mid-rate — re-value these '
  'when real rates land), assumed (the source did not say; the journal''s '
  'account_currency was used).';

commit;

-- rollback:
--   begin;
--   drop index if exists public.trades_pnl_rate_quality_idx;
--   alter table public.trades drop constraint if exists trades_pnl_rate_quality_allowed;
--   alter table public.trades drop constraint if exists trades_pnl_currency_iso;
--   alter table public.trades drop column if exists pnl_rate_quality;
--   alter table public.trades drop column if exists pnl_currency;
--   commit;
