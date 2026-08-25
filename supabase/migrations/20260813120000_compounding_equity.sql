-- Compounding account equity.
--
-- Until now a journal's capital was a static number: risk % was always taken
-- from the STARTING capital, so a doubled account still risked the same money
-- and a drawdown still risked too much. The account balance also existed
-- nowhere — the equity curve plotted cumulative profit from zero.
--
-- Two columns are enough to make the capital live:
--   journals.risk_basis   'compounding' -> risk % of the CURRENT balance
--                         (starting capital + all closed P&L), so gains
--                         compound and losses shrink size automatically;
--                         'fixed'       -> risk % of the starting capital.
--   trades.risk_percent   per-trade money management: this trade risked 0.5%
--                         while the journal default is 1%. NULL = use the
--                         journal default, so existing rows are unaffected.
--
-- The running balance itself is DERIVED (capital + closed P&L), not stored:
-- one source of truth, nothing to drift out of sync when a trade is edited.
alter table public.journals
  add column if not exists risk_basis text not null default 'compounding';

alter table public.journals
  drop constraint if exists journals_risk_basis_allowed;
alter table public.journals
  add constraint journals_risk_basis_allowed
  check (risk_basis in ('compounding', 'fixed'));

alter table public.trades
  add column if not exists risk_percent numeric;

alter table public.trades
  drop constraint if exists trades_risk_percent_range;
alter table public.trades
  add constraint trades_risk_percent_range
  check (risk_percent is null or (risk_percent > 0 and risk_percent <= 100));

comment on column public.journals.risk_basis is
  'compounding = size off the live balance; fixed = size off the starting capital.';
comment on column public.trades.risk_percent is
  'Percent of the account risked on THIS trade. NULL = journal default_risk_percent.';
