-- Per-journal account capital + default risk, so position size can be DERIVED
-- instead of typed on every trade.
--
-- Today a trader must enter "Quantity" (units) by hand for the P&L math to
-- mean anything. With the account size and a risk-per-trade percentage stored
-- on the journal, the trade form can size the position itself from
-- entry + stop loss (the same computeLotSize math the Lot Size Calculator
-- already uses) — the quantity field becomes a suggestion the user can accept
-- or override.
--
-- All three columns are nullable / defaulted so existing journals keep working
-- untouched: with no initial_capital set, nothing auto-sizes and the form
-- behaves exactly as before.
alter table public.journals
  add column if not exists initial_capital numeric,
  add column if not exists account_currency text not null default 'USD',
  add column if not exists default_risk_percent numeric not null default 1;

-- Capital is an account balance: positive when present, never zero/negative.
alter table public.journals
  drop constraint if exists journals_initial_capital_positive;
alter table public.journals
  add constraint journals_initial_capital_positive
  check (initial_capital is null or initial_capital > 0);

-- Risk sizing only makes sense inside a sane band. 0 would size nothing and
-- >100% would risk more than the account holds.
alter table public.journals
  drop constraint if exists journals_default_risk_percent_range;
alter table public.journals
  add constraint journals_default_risk_percent_range
  check (default_risk_percent > 0 and default_risk_percent <= 100);

-- Matches the AccountCurrency union the sizing math supports.
alter table public.journals
  drop constraint if exists journals_account_currency_allowed;
alter table public.journals
  add constraint journals_account_currency_allowed
  check (account_currency in ('USD', 'EUR', 'GBP'));

comment on column public.journals.initial_capital is
  'Account size for this journal, in account_currency. Null = auto-sizing off.';
comment on column public.journals.account_currency is
  'Base currency of the account balance (USD | EUR | GBP).';
comment on column public.journals.default_risk_percent is
  'Percent of capital risked per trade, used to derive position size.';
