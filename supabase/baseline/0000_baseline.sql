--
-- PostgreSQL database dump
--

\restrict LYdY9QURDAnVfsYXXj235oAa5N6gveSm1PSQ51gs8vEMJ6Cgk0vSKOW6HWkoEF2

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: order_type_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_type_kind AS ENUM (
    'market',
    'limit',
    'stop'
);


--
-- Name: tp_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tp_result AS ENUM (
    'hit',
    'be',
    'sl'
);


--
-- Name: accept_journal_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_journal_invite(p_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invite RECORD;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to accept invite';
  END IF;

  SELECT * INTO v_invite
  FROM public.journal_invites
  WHERE token = p_token
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite has already been accepted';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite has been revoked';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  -- Already a member? Just mark the invite accepted and return.
  IF EXISTS (
    SELECT 1 FROM public.journal_members
    WHERE journal_id = v_invite.journal_id AND user_id = v_caller
  ) THEN
    UPDATE public.journal_invites
    SET accepted_at = now(), accepted_by_user_id = v_caller
    WHERE id = v_invite.id;
    RETURN v_invite.journal_id;
  END IF;

  INSERT INTO public.journal_members (journal_id, user_id, role, invited_by_user_id)
  VALUES (v_invite.journal_id, v_caller, v_invite.role, v_invite.created_by_user_id);

  UPDATE public.journal_invites
  SET accepted_at = now(), accepted_by_user_id = v_caller
  WHERE id = v_invite.id;

  RETURN v_invite.journal_id;
END;
$$;


--
-- Name: add_owner_as_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_owner_as_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.journal_members (journal_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: create_personal_journal_for_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_personal_journal_for_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.journals (owner_user_id, name, color)
  VALUES (NEW.id, 'Personal', 'slate')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_journal_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_journal_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  active_count integer;
BEGIN
  SELECT count(*) INTO active_count FROM public.journals
  WHERE owner_user_id = NEW.owner_user_id AND is_archived = false;
  IF active_count >= 20 THEN
    RAISE EXCEPTION 'Maximum 20 active journals per user reached.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_member_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_member_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  mem_count integer;
BEGIN
  SELECT count(*) INTO mem_count FROM public.journal_members
  WHERE journal_id = NEW.journal_id;
  IF mem_count >= 50 THEN
    RAISE EXCEPTION 'Maximum 50 members per journal reached.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_invite_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invite_token() RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN replace(replace(replace(
    encode(gen_random_bytes(18), 'base64'),
    '+', '-'), '/', '_'), '=', '');
END;
$$;


--
-- Name: get_invite_public_info(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invite_public_info(p_token text) RETURNS TABLE(journal_id uuid, journal_name text, journal_color text, role text, inviter_email text, inviter_name text, expires_at timestamp with time zone, accepted_at timestamp with time zone, revoked_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    ji.journal_id,
    j.name::text,
    j.color::text,
    ji.role::text,
    u.email::text,
    COALESCE(pu.full_name, '')::text,
    ji.expires_at,
    ji.accepted_at,
    ji.revoked_at
  FROM public.journal_invites ji
  JOIN public.journals j ON j.id = ji.journal_id
  JOIN auth.users u ON u.id = ji.created_by_user_id
  LEFT JOIN public.users pu ON pu.id = ji.created_by_user_id
  WHERE ji.token = p_token;
$$;


--
-- Name: get_journal_members_with_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_journal_members_with_info(p_journal_id uuid) RETURNS TABLE(user_id uuid, email text, full_name text, avatar_url text, role text, joined_at timestamp with time zone, invited_by_user_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    jm.user_id,
    u.email::text,
    COALESCE(pu.full_name, '')::text,
    COALESCE(pu.avatar_url, '')::text,
    jm.role::text,
    jm.joined_at,
    jm.invited_by_user_id
  FROM public.journal_members jm
  JOIN auth.users u ON u.id = jm.user_id
  LEFT JOIN public.users pu ON pu.id = jm.user_id
  WHERE jm.journal_id = p_journal_id
    AND public.user_can_access_journal(p_journal_id)
  ORDER BY (jm.role = 'owner') DESC, jm.joined_at ASC;
$$;


--
-- Name: get_my_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;


--
-- Name: get_trade_authors_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_trade_authors_info(p_journal_id uuid) RETURNS TABLE(user_id uuid, email text, full_name text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT ON (u.id)
    u.id,
    u.email::text,
    COALESCE(pu.full_name, '')::text,
    COALESCE(pu.avatar_url, '')::text
  FROM auth.users u
  LEFT JOIN public.users pu ON pu.id = u.id
  WHERE u.id IN (
    SELECT DISTINCT t.user_id
    FROM public.trades t
    WHERE t.journal_id = p_journal_id
      AND t.user_id IS NOT NULL
  )
  AND public.user_can_access_journal(p_journal_id);
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  );
  RETURN NEW;
END;
$$;


--
-- Name: log_trade_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_trade_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := auth.uid();
  changed text[] := ARRAY[]::text[];
  k text;
  -- Skip stamping-only changes so we don't pollute the feed with no-ops
  skip_keys text[] := ARRAY['last_edited_by_user_id','last_edited_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.trade_audit_log (trade_id, journal_id, actor_user_id, action, after_data)
    VALUES (NEW.id, NEW.journal_id, actor, 'created', to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k)
         AND NOT (k = ANY(skip_keys)) THEN
        changed := array_append(changed, k);
      END IF;
    END LOOP;
    IF array_length(changed, 1) IS NULL THEN
      RETURN NEW;  -- only stamp fields changed, don't log
    END IF;
    INSERT INTO public.trade_audit_log
      (trade_id, journal_id, actor_user_id, action, changed_fields, before_data, after_data)
    VALUES (NEW.id, NEW.journal_id, actor, 'updated', changed, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.trade_audit_log (trade_id, journal_id, actor_user_id, action, before_data)
    VALUES (OLD.id, OLD.journal_id, actor, 'deleted', to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: prevent_journal_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_journal_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Journals cannot be deleted. Set is_archived=true instead.';
END;
$$;


--
-- Name: prevent_removing_last_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_removing_last_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  owner_count integer;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'owner' THEN
    SELECT count(*) INTO owner_count FROM public.journal_members
    WHERE journal_id = OLD.journal_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner. Transfer ownership first.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner' THEN
    SELECT count(*) INTO owner_count FROM public.journal_members
    WHERE journal_id = OLD.journal_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner. Transfer ownership first.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: stamp_trade_edit_metadata(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_trade_edit_metadata() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.last_edited_by_user_id := auth.uid();
  NEW.last_edited_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: user_can_access_journal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_can_access_journal(p_journal_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journal_members
    WHERE journal_id = p_journal_id AND user_id = auth.uid()
  );
$$;


--
-- Name: user_journal_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_journal_role(p_journal_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.journal_members
  WHERE journal_id = p_journal_id AND user_id = auth.uid()
  LIMIT 1;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);


--
-- Name: journal_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_id uuid NOT NULL,
    token text DEFAULT public.generate_invite_token() NOT NULL,
    role text NOT NULL,
    created_by_user_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_user_id uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_invites_role_check CHECK ((role = ANY (ARRAY['member'::text, 'viewer'::text])))
);


--
-- Name: journal_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_members (
    journal_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    invited_by_user_id uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text, 'viewer'::text])))
);


--
-- Name: journals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL,
    description text,
    is_archived boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    initial_capital numeric,
    account_currency text DEFAULT 'USD'::text NOT NULL,
    default_risk_percent numeric DEFAULT 1 NOT NULL,
    CONSTRAINT journals_account_currency_allowed CHECK ((account_currency = ANY (ARRAY['USD'::text, 'EUR'::text, 'GBP'::text]))),
    CONSTRAINT journals_color_check CHECK ((color = ANY (ARRAY['slate'::text, 'emerald'::text, 'sky'::text, 'violet'::text, 'orange'::text, 'cyan'::text, 'rose'::text, 'lime'::text, 'amber'::text, 'red'::text]))),
    CONSTRAINT journals_default_risk_percent_range CHECK (((default_risk_percent > (0)::numeric) AND (default_risk_percent <= (100)::numeric))),
    CONSTRAINT journals_description_check CHECK (((description IS NULL) OR (char_length(description) <= 300))),
    CONSTRAINT journals_initial_capital_positive CHECK (((initial_capital IS NULL) OR (initial_capital > (0)::numeric))),
    CONSTRAINT journals_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);


--
-- Name: COLUMN journals.initial_capital; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.journals.initial_capital IS 'Account size for this journal, in account_currency. Null = auto-sizing off.';


--
-- Name: COLUMN journals.account_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.journals.account_currency IS 'Base currency of the account balance (USD | EUR | GBP).';


--
-- Name: COLUMN journals.default_risk_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.journals.default_risk_percent IS 'Percent of capital risked per trade, used to derive position size.';


--
-- Name: mt5_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mt5_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    journal_id uuid NOT NULL,
    label text,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    account_login text,
    broker text,
    last_sync_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE mt5_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mt5_connections IS 'MT5 connector tokens. One per MT5 account -> journal link; token stored as sha256 hash.';


--
-- Name: myfxbook_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.myfxbook_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    journal_id uuid NOT NULL,
    email_encrypted text NOT NULL,
    password_encrypted text NOT NULL,
    session_token text,
    myfxbook_account_id text NOT NULL,
    account_name text,
    broker text,
    last_sync_at timestamp with time zone,
    last_error text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE myfxbook_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.myfxbook_connections IS 'Myfxbook-linked MT4/MT5 accounts for free auto-sync. Credentials encrypted app-side (AES-256-GCM).';


--
-- Name: signal_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signal_events_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'SENT'::text, 'ACTIVATED'::text, 'TP1_HIT'::text, 'TP2_HIT'::text, 'TP3_HIT'::text, 'TP4_HIT'::text, 'SL_HIT'::text, 'CLOSED'::text, 'CANCELLED'::text])))
);


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trader_id uuid NOT NULL,
    instrument text NOT NULL,
    direction text NOT NULL,
    entry_price numeric NOT NULL,
    stop_loss numeric NOT NULL,
    tp1 numeric,
    tp2 numeric,
    tp3 numeric,
    tp4 numeric,
    notes text,
    status text DEFAULT 'CREATED'::text NOT NULL,
    telegram_message_id bigint,
    formatted_message text,
    pips_to_sl numeric,
    pips_to_tp1 numeric,
    risk_amount numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signals_direction_check CHECK ((direction = ANY (ARRAY['buy'::text, 'sell'::text]))),
    CONSTRAINT signals_status_check CHECK ((status = ANY (ARRAY['CREATED'::text, 'SENT'::text, 'ACTIVE'::text, 'TP_HIT'::text, 'SL_HIT'::text, 'CLOSED'::text])))
);


--
-- Name: trade_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid,
    journal_id uuid,
    actor_user_id uuid,
    action text NOT NULL,
    changed_fields text[] DEFAULT ARRAY[]::text[] NOT NULL,
    before_data jsonb,
    after_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trade_audit_log_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text])))
);


--
-- Name: trade_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    journal_id uuid NOT NULL,
    insights jsonb DEFAULT '{}'::jsonb NOT NULL,
    stats_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    trades_analyzed integer DEFAULT 0 NOT NULL
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    instrument text NOT NULL,
    asset_type text NOT NULL,
    direction text NOT NULL,
    entry_price numeric NOT NULL,
    exit_price numeric,
    quantity numeric NOT NULL,
    lot_size numeric,
    stop_loss numeric,
    take_profit numeric,
    fees numeric DEFAULT 0,
    notes text,
    tags text[] DEFAULT '{}'::text[],
    entry_time timestamp with time zone NOT NULL,
    exit_time timestamp with time zone,
    pnl_absolute numeric,
    pnl_percentage numeric,
    risk_reward_ratio numeric,
    r_multiple numeric,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entry_price_high numeric(20,8),
    tp1 numeric(20,8),
    tp2 numeric(20,8),
    tp3 numeric(20,8),
    tp4 numeric(20,8),
    sl_pips numeric(20,4),
    tp1_pips numeric(20,4),
    tp2_pips numeric(20,4),
    tp3_pips numeric(20,4),
    tp4_pips numeric(20,4),
    tp4_trailing boolean DEFAULT false NOT NULL,
    num_positions integer DEFAULT 1 NOT NULL,
    split_risk boolean DEFAULT false NOT NULL,
    tp1_result public.tp_result,
    tp2_result public.tp_result,
    tp3_result public.tp_result,
    tp4_result public.tp_result,
    order_type public.order_type_kind DEFAULT 'market'::public.order_type_kind NOT NULL,
    tp5 numeric(20,8),
    tp6 numeric(20,8),
    tp7 numeric(20,8),
    tp5_pips numeric,
    tp6_pips numeric,
    tp7_pips numeric,
    tp5_result text,
    tp6_result text,
    tp7_result text,
    journal_id uuid NOT NULL,
    last_edited_by_user_id uuid,
    last_edited_at timestamp with time zone,
    emotion text,
    emotion_post text,
    mt5_account text,
    mt5_ticket bigint,
    CONSTRAINT trades_asset_type_check CHECK ((asset_type = ANY (ARRAY['forex'::text, 'crypto'::text, 'metal'::text]))),
    CONSTRAINT trades_direction_check CHECK ((direction = ANY (ARRAY['buy'::text, 'sell'::text]))),
    CONSTRAINT trades_entry_range_chk CHECK (((entry_price_high IS NULL) OR (entry_price_high >= entry_price))),
    CONSTRAINT trades_num_positions_chk CHECK (((num_positions >= 1) AND (num_positions <= 10))),
    CONSTRAINT trades_sl_tp_geometry_chk CHECK ((((stop_loss IS NULL) OR ((direction = 'buy'::text) AND (stop_loss < entry_price)) OR ((direction = 'sell'::text) AND (stop_loss > entry_price))) AND ((take_profit IS NULL) OR ((direction = 'buy'::text) AND (take_profit > entry_price)) OR ((direction = 'sell'::text) AND (take_profit < entry_price))) AND ((tp1 IS NULL) OR ((direction = 'buy'::text) AND (tp1 > entry_price)) OR ((direction = 'sell'::text) AND (tp1 < entry_price))) AND ((tp2 IS NULL) OR ((direction = 'buy'::text) AND (tp2 > entry_price)) OR ((direction = 'sell'::text) AND (tp2 < entry_price))) AND ((tp3 IS NULL) OR ((direction = 'buy'::text) AND (tp3 > entry_price)) OR ((direction = 'sell'::text) AND (tp3 < entry_price))) AND ((tp4 IS NULL) OR ((direction = 'buy'::text) AND (tp4 > entry_price)) OR ((direction = 'sell'::text) AND (tp4 < entry_price))) AND ((tp5 IS NULL) OR ((direction = 'buy'::text) AND (tp5 > entry_price)) OR ((direction = 'sell'::text) AND (tp5 < entry_price))) AND ((tp6 IS NULL) OR ((direction = 'buy'::text) AND (tp6 > entry_price)) OR ((direction = 'sell'::text) AND (tp6 < entry_price))) AND ((tp7 IS NULL) OR ((direction = 'buy'::text) AND (tp7 > entry_price)) OR ((direction = 'sell'::text) AND (tp7 < entry_price))))),
    CONSTRAINT trades_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'csv'::text, 'mt5_webhook'::text]))),
    CONSTRAINT trades_tp5_result_chk CHECK (((tp5_result IS NULL) OR (tp5_result = ANY (ARRAY['hit'::text, 'be'::text, 'sl'::text])))),
    CONSTRAINT trades_tp6_result_chk CHECK (((tp6_result IS NULL) OR (tp6_result = ANY (ARRAY['hit'::text, 'be'::text, 'sl'::text])))),
    CONSTRAINT trades_tp7_result_chk CHECK (((tp7_result IS NULL) OR (tp7_result = ANY (ARRAY['hit'::text, 'be'::text, 'sl'::text]))))
);


--
-- Name: COLUMN trades.emotion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trades.emotion IS 'Optional entry emotion (single-select): calm, confident, disciplined, neutral, excited, overconfident, anxious, fearful, greedy, fomo, revenge, frustrated.';


--
-- Name: COLUMN trades.emotion_post; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trades.emotion_post IS 'Optional post-trade emotion (single-select). Same value set as emotion.';


--
-- Name: COLUMN trades.mt5_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trades.mt5_account IS 'MT5 source account as "{server}:{login}". Dedupe key component.';


--
-- Name: COLUMN trades.mt5_ticket; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trades.mt5_ticket IS 'MT5 position identifier (DEAL_POSITION_ID). Dedupe key for the MT5 connector.';


--
-- Name: user_favorite_instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_favorite_instruments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    instrument text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_favorite_instruments_instrument_check CHECK (((char_length(instrument) >= 1) AND (char_length(instrument) <= 32)))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_onboarded boolean DEFAULT false,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'trader'::text, 'admin'::text])))
);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: journal_invites journal_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_invites
    ADD CONSTRAINT journal_invites_pkey PRIMARY KEY (id);


--
-- Name: journal_invites journal_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_invites
    ADD CONSTRAINT journal_invites_token_key UNIQUE (token);


--
-- Name: journal_members journal_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_members
    ADD CONSTRAINT journal_members_pkey PRIMARY KEY (journal_id, user_id);


--
-- Name: journals journals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journals
    ADD CONSTRAINT journals_pkey PRIMARY KEY (id);


--
-- Name: mt5_connections mt5_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mt5_connections
    ADD CONSTRAINT mt5_connections_pkey PRIMARY KEY (id);


--
-- Name: mt5_connections mt5_connections_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mt5_connections
    ADD CONSTRAINT mt5_connections_token_hash_key UNIQUE (token_hash);


--
-- Name: myfxbook_connections myfxbook_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.myfxbook_connections
    ADD CONSTRAINT myfxbook_connections_pkey PRIMARY KEY (id);


--
-- Name: signal_events signal_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_events
    ADD CONSTRAINT signal_events_pkey PRIMARY KEY (id);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: signals signals_sl_tp_geometry_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.signals
    ADD CONSTRAINT signals_sl_tp_geometry_chk CHECK ((((direction = 'buy'::text) AND (stop_loss < entry_price) AND ((tp1 IS NULL) OR (tp1 > entry_price)) AND ((tp2 IS NULL) OR (tp2 > entry_price)) AND ((tp3 IS NULL) OR (tp3 > entry_price)) AND ((tp4 IS NULL) OR (tp4 > entry_price))) OR ((direction = 'sell'::text) AND (stop_loss > entry_price) AND ((tp1 IS NULL) OR (tp1 < entry_price)) AND ((tp2 IS NULL) OR (tp2 < entry_price)) AND ((tp3 IS NULL) OR (tp3 < entry_price)) AND ((tp4 IS NULL) OR (tp4 < entry_price))))) NOT VALID;


--
-- Name: trade_audit_log trade_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_audit_log
    ADD CONSTRAINT trade_audit_log_pkey PRIMARY KEY (id);


--
-- Name: trade_insights trade_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_insights
    ADD CONSTRAINT trade_insights_pkey PRIMARY KEY (id);


--
-- Name: trade_insights trade_insights_user_id_journal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_insights
    ADD CONSTRAINT trade_insights_user_id_journal_id_key UNIQUE (user_id, journal_id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: user_favorite_instruments user_favorite_instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_instruments
    ADD CONSTRAINT user_favorite_instruments_pkey PRIMARY KEY (id);


--
-- Name: user_favorite_instruments user_favorite_instruments_user_id_instrument_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_instruments
    ADD CONSTRAINT user_favorite_instruments_user_id_instrument_key UNIQUE (user_id, instrument);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: chat_messages_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_user_id_idx ON public.chat_messages USING btree (user_id, created_at DESC);


--
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);


--
-- Name: idx_chat_messages_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id);


--
-- Name: idx_signal_events_signal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_events_signal_id ON public.signal_events USING btree (signal_id);


--
-- Name: idx_signals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_status ON public.signals USING btree (status);


--
-- Name: idx_signals_trader_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_trader_id ON public.signals USING btree (trader_id);


--
-- Name: idx_trades_entry_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_entry_time ON public.trades USING btree (entry_time);


--
-- Name: idx_trades_instrument; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_instrument ON public.trades USING btree (instrument);


--
-- Name: idx_trades_order_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_order_type ON public.trades USING btree (order_type);


--
-- Name: idx_trades_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_tags ON public.trades USING gin (tags);


--
-- Name: idx_trades_tp1_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_tp1_result ON public.trades USING btree (tp1_result) WHERE (tp1_result IS NOT NULL);


--
-- Name: idx_trades_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_user_id ON public.trades USING btree (user_id);


--
-- Name: journal_invites_active_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_invites_active_token_idx ON public.journal_invites USING btree (token) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: journal_invites_journal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_invites_journal_idx ON public.journal_invites USING btree (journal_id, created_at DESC);


--
-- Name: journal_members_one_owner_per_journal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_members_one_owner_per_journal ON public.journal_members USING btree (journal_id) WHERE (role = 'owner'::text);


--
-- Name: journal_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_members_user_idx ON public.journal_members USING btree (user_id);


--
-- Name: journals_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journals_active_idx ON public.journals USING btree (owner_user_id) WHERE (is_archived = false);


--
-- Name: journals_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journals_owner_idx ON public.journals USING btree (owner_user_id, sort_order, created_at);


--
-- Name: journals_unique_name_per_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journals_unique_name_per_owner ON public.journals USING btree (owner_user_id, lower(name));


--
-- Name: trade_audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_audit_actor_idx ON public.trade_audit_log USING btree (actor_user_id, created_at DESC);


--
-- Name: trade_audit_journal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_audit_journal_idx ON public.trade_audit_log USING btree (journal_id, created_at DESC);


--
-- Name: trade_audit_trade_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_audit_trade_idx ON public.trade_audit_log USING btree (trade_id, created_at DESC);


--
-- Name: trades_journal_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_journal_author_idx ON public.trades USING btree (journal_id, user_id, entry_time DESC);


--
-- Name: trades_journal_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_journal_entry_idx ON public.trades USING btree (journal_id, entry_time DESC);


--
-- Name: trades_mt5_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trades_mt5_dedupe ON public.trades USING btree (journal_id, mt5_account, mt5_ticket);


--
-- Name: user_favorite_instruments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_favorite_instruments_user_idx ON public.user_favorite_instruments USING btree (user_id, created_at);


--
-- Name: journals add_owner_as_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER add_owner_as_member AFTER INSERT ON public.journals FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();


--
-- Name: journals enforce_journal_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_journal_cap BEFORE INSERT ON public.journals FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_cap();


--
-- Name: journal_members enforce_member_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_member_cap BEFORE INSERT ON public.journal_members FOR EACH ROW EXECUTE FUNCTION public.enforce_member_cap();


--
-- Name: trades log_trade_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_trade_change AFTER INSERT OR DELETE OR UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.log_trade_change();


--
-- Name: journals prevent_journal_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_journal_delete BEFORE DELETE ON public.journals FOR EACH ROW EXECUTE FUNCTION public.prevent_journal_delete();


--
-- Name: journal_members prevent_last_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_last_owner BEFORE DELETE OR UPDATE ON public.journal_members FOR EACH ROW EXECUTE FUNCTION public.prevent_removing_last_owner();


--
-- Name: journals set_journals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_journals_updated_at BEFORE UPDATE ON public.journals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: signals signals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER signals_updated_at BEFORE UPDATE ON public.signals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: trades stamp_trade_edit_metadata; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_trade_edit_metadata BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.stamp_trade_edit_metadata();


--
-- Name: trades trades_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trades_updated_at BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: journal_invites journal_invites_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_invites
    ADD CONSTRAINT journal_invites_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: journal_invites journal_invites_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_invites
    ADD CONSTRAINT journal_invites_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: journal_invites journal_invites_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_invites
    ADD CONSTRAINT journal_invites_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: journal_members journal_members_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_members
    ADD CONSTRAINT journal_members_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: journal_members journal_members_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_members
    ADD CONSTRAINT journal_members_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: journal_members journal_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_members
    ADD CONSTRAINT journal_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: journals journals_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journals
    ADD CONSTRAINT journals_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mt5_connections mt5_connections_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mt5_connections
    ADD CONSTRAINT mt5_connections_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: mt5_connections mt5_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mt5_connections
    ADD CONSTRAINT mt5_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: myfxbook_connections myfxbook_connections_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.myfxbook_connections
    ADD CONSTRAINT myfxbook_connections_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: myfxbook_connections myfxbook_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.myfxbook_connections
    ADD CONSTRAINT myfxbook_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: signal_events signal_events_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_events
    ADD CONSTRAINT signal_events_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE CASCADE;


--
-- Name: signals signals_trader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_trader_id_fkey FOREIGN KEY (trader_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trade_audit_log trade_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_audit_log
    ADD CONSTRAINT trade_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: trade_audit_log trade_audit_log_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_audit_log
    ADD CONSTRAINT trade_audit_log_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: trade_audit_log trade_audit_log_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_audit_log
    ADD CONSTRAINT trade_audit_log_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE SET NULL;


--
-- Name: trade_insights trade_insights_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_insights
    ADD CONSTRAINT trade_insights_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE;


--
-- Name: trade_insights trade_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_insights
    ADD CONSTRAINT trade_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trades trades_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE RESTRICT;


--
-- Name: trades trades_last_edited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_last_edited_by_user_id_fkey FOREIGN KEY (last_edited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: trades trades_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_favorite_instruments user_favorite_instruments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_instruments
    ADD CONSTRAINT user_favorite_instruments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trade_insights Service role all insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role all insights" ON public.trade_insights USING (true) WITH CHECK (true);


--
-- Name: chat_messages Service role all messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role all messages" ON public.chat_messages USING (true) WITH CHECK (true);


--
-- Name: trade_insights Service role manages insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages insights" ON public.trade_insights USING (true) WITH CHECK (true);


--
-- Name: chat_messages Service role manages messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages messages" ON public.chat_messages USING (true) WITH CHECK (true);


--
-- Name: trade_insights Users can read own insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own insights" ON public.trade_insights FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: chat_messages Users can read own messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own messages" ON public.chat_messages FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trade_insights Users read own insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own insights" ON public.trade_insights FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: chat_messages Users read own messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own messages" ON public.chat_messages FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trade_audit_log audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select ON public.trade_audit_log FOR SELECT TO authenticated USING (public.user_can_access_journal(journal_id));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_own ON public.chat_messages USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: journal_invites invites_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invites_delete ON public.journal_invites FOR DELETE TO authenticated USING ((public.user_journal_role(journal_id) = 'owner'::text));


--
-- Name: journal_invites invites_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invites_insert ON public.journal_invites FOR INSERT TO authenticated WITH CHECK (((public.user_journal_role(journal_id) = 'owner'::text) AND (created_by_user_id = auth.uid())));


--
-- Name: journal_invites invites_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invites_select ON public.journal_invites FOR SELECT TO authenticated USING ((public.user_journal_role(journal_id) = 'owner'::text));


--
-- Name: journal_invites invites_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invites_update ON public.journal_invites FOR UPDATE TO authenticated USING ((public.user_journal_role(journal_id) = 'owner'::text)) WITH CHECK ((public.user_journal_role(journal_id) = 'owner'::text));


--
-- Name: journal_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_members ENABLE ROW LEVEL SECURITY;

--
-- Name: journals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journals ENABLE ROW LEVEL SECURITY;

--
-- Name: journals journals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journals_insert ON public.journals FOR INSERT TO authenticated WITH CHECK ((owner_user_id = auth.uid()));


--
-- Name: journals journals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journals_select ON public.journals FOR SELECT TO authenticated USING (public.user_can_access_journal(id));


--
-- Name: journals journals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journals_update ON public.journals FOR UPDATE TO authenticated USING ((public.user_journal_role(id) = 'owner'::text)) WITH CHECK ((public.user_journal_role(id) = 'owner'::text));


--
-- Name: journal_members members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_delete ON public.journal_members FOR DELETE TO authenticated USING ((((public.user_journal_role(journal_id) = 'owner'::text) AND (role <> 'owner'::text)) OR ((user_id = auth.uid()) AND (role <> 'owner'::text))));


--
-- Name: journal_members members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_insert ON public.journal_members FOR INSERT TO authenticated WITH CHECK ((public.user_journal_role(journal_id) = 'owner'::text));


--
-- Name: journal_members members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_select ON public.journal_members FOR SELECT TO authenticated USING (public.user_can_access_journal(journal_id));


--
-- Name: journal_members members_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_update ON public.journal_members FOR UPDATE TO authenticated USING ((public.user_journal_role(journal_id) = 'owner'::text)) WITH CHECK (((public.user_journal_role(journal_id) = 'owner'::text) AND (role <> 'owner'::text)));


--
-- Name: mt5_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mt5_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: mt5_connections mt5_connections_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt5_connections_delete_own ON public.mt5_connections FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: mt5_connections mt5_connections_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt5_connections_insert_own ON public.mt5_connections FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: mt5_connections mt5_connections_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt5_connections_select_own ON public.mt5_connections FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: mt5_connections mt5_connections_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt5_connections_update_own ON public.mt5_connections FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: myfxbook_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.myfxbook_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: myfxbook_connections myfxbook_connections_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY myfxbook_connections_delete_own ON public.myfxbook_connections FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: myfxbook_connections myfxbook_connections_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY myfxbook_connections_insert_own ON public.myfxbook_connections FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: myfxbook_connections myfxbook_connections_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY myfxbook_connections_select_own ON public.myfxbook_connections FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: myfxbook_connections myfxbook_connections_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY myfxbook_connections_update_own ON public.myfxbook_connections FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: signal_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;

--
-- Name: signal_events signal_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signal_events_insert ON public.signal_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.signals s
  WHERE ((s.id = signal_events.signal_id) AND (s.trader_id = auth.uid())))));


--
-- Name: signal_events signal_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signal_events_read ON public.signal_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.signals s
  WHERE ((s.id = signal_events.signal_id) AND ((s.trader_id = auth.uid()) OR (public.get_my_role() = ANY (ARRAY['admin'::text, 'trader'::text])))))));


--
-- Name: signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

--
-- Name: signals signals_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signals_delete ON public.signals FOR DELETE USING ((trader_id = auth.uid()));


--
-- Name: signals signals_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signals_read ON public.signals FOR SELECT USING (((trader_id = auth.uid()) OR (public.get_my_role() = ANY (ARRAY['admin'::text, 'trader'::text]))));


--
-- Name: signals signals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signals_update ON public.signals FOR UPDATE USING ((trader_id = auth.uid())) WITH CHECK ((trader_id = auth.uid()));


--
-- Name: signals signals_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signals_write ON public.signals FOR INSERT WITH CHECK ((trader_id = auth.uid()));


--
-- Name: trade_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trade_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: trade_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trade_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: user_favorite_instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_favorite_instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: user_favorite_instruments users_delete_own_favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete_own_favorites ON public.user_favorite_instruments FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_favorite_instruments users_insert_own_favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_favorites ON public.user_favorite_instruments FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: users users_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own ON public.users USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: user_favorite_instruments users_select_own_favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own_favorites ON public.user_favorite_instruments FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION accept_journal_invite(p_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.accept_journal_invite(p_token text) TO anon;
GRANT ALL ON FUNCTION public.accept_journal_invite(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.accept_journal_invite(p_token text) TO service_role;


--
-- Name: FUNCTION add_owner_as_member(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_owner_as_member() TO anon;
GRANT ALL ON FUNCTION public.add_owner_as_member() TO authenticated;
GRANT ALL ON FUNCTION public.add_owner_as_member() TO service_role;


--
-- Name: FUNCTION create_personal_journal_for_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_personal_journal_for_user() TO anon;
GRANT ALL ON FUNCTION public.create_personal_journal_for_user() TO authenticated;
GRANT ALL ON FUNCTION public.create_personal_journal_for_user() TO service_role;


--
-- Name: FUNCTION enforce_journal_cap(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_journal_cap() TO anon;
GRANT ALL ON FUNCTION public.enforce_journal_cap() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_journal_cap() TO service_role;


--
-- Name: FUNCTION enforce_member_cap(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_member_cap() TO anon;
GRANT ALL ON FUNCTION public.enforce_member_cap() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_member_cap() TO service_role;


--
-- Name: FUNCTION generate_invite_token(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_invite_token() TO anon;
GRANT ALL ON FUNCTION public.generate_invite_token() TO authenticated;
GRANT ALL ON FUNCTION public.generate_invite_token() TO service_role;


--
-- Name: FUNCTION get_invite_public_info(p_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_invite_public_info(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_invite_public_info(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.get_invite_public_info(p_token text) TO service_role;


--
-- Name: FUNCTION get_journal_members_with_info(p_journal_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_journal_members_with_info(p_journal_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_journal_members_with_info(p_journal_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_journal_members_with_info(p_journal_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_role() TO anon;
GRANT ALL ON FUNCTION public.get_my_role() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_role() TO service_role;


--
-- Name: FUNCTION get_trade_authors_info(p_journal_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_trade_authors_info(p_journal_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_trade_authors_info(p_journal_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_trade_authors_info(p_journal_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION log_trade_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_trade_change() TO anon;
GRANT ALL ON FUNCTION public.log_trade_change() TO authenticated;
GRANT ALL ON FUNCTION public.log_trade_change() TO service_role;


--
-- Name: FUNCTION prevent_journal_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_journal_delete() TO anon;
GRANT ALL ON FUNCTION public.prevent_journal_delete() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_journal_delete() TO service_role;


--
-- Name: FUNCTION prevent_removing_last_owner(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_removing_last_owner() TO anon;
GRANT ALL ON FUNCTION public.prevent_removing_last_owner() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_removing_last_owner() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION stamp_trade_edit_metadata(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.stamp_trade_edit_metadata() TO anon;
GRANT ALL ON FUNCTION public.stamp_trade_edit_metadata() TO authenticated;
GRANT ALL ON FUNCTION public.stamp_trade_edit_metadata() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: FUNCTION user_can_access_journal(p_journal_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_can_access_journal(p_journal_id uuid) TO anon;
GRANT ALL ON FUNCTION public.user_can_access_journal(p_journal_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_can_access_journal(p_journal_id uuid) TO service_role;


--
-- Name: FUNCTION user_journal_role(p_journal_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_journal_role(p_journal_id uuid) TO anon;
GRANT ALL ON FUNCTION public.user_journal_role(p_journal_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_journal_role(p_journal_id uuid) TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE journal_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.journal_invites TO anon;
GRANT ALL ON TABLE public.journal_invites TO authenticated;
GRANT ALL ON TABLE public.journal_invites TO service_role;


--
-- Name: TABLE journal_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.journal_members TO anon;
GRANT ALL ON TABLE public.journal_members TO authenticated;
GRANT ALL ON TABLE public.journal_members TO service_role;


--
-- Name: TABLE journals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.journals TO anon;
GRANT ALL ON TABLE public.journals TO authenticated;
GRANT ALL ON TABLE public.journals TO service_role;


--
-- Name: TABLE mt5_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mt5_connections TO anon;
GRANT ALL ON TABLE public.mt5_connections TO authenticated;
GRANT ALL ON TABLE public.mt5_connections TO service_role;


--
-- Name: TABLE myfxbook_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.myfxbook_connections TO anon;
GRANT ALL ON TABLE public.myfxbook_connections TO authenticated;
GRANT ALL ON TABLE public.myfxbook_connections TO service_role;


--
-- Name: TABLE signal_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.signal_events TO anon;
GRANT ALL ON TABLE public.signal_events TO authenticated;
GRANT ALL ON TABLE public.signal_events TO service_role;


--
-- Name: TABLE signals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.signals TO anon;
GRANT ALL ON TABLE public.signals TO authenticated;
GRANT ALL ON TABLE public.signals TO service_role;


--
-- Name: TABLE trade_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trade_audit_log TO anon;
GRANT ALL ON TABLE public.trade_audit_log TO authenticated;
GRANT ALL ON TABLE public.trade_audit_log TO service_role;


--
-- Name: TABLE trade_insights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trade_insights TO anon;
GRANT ALL ON TABLE public.trade_insights TO authenticated;
GRANT ALL ON TABLE public.trade_insights TO service_role;


--
-- Name: TABLE trades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trades TO anon;
GRANT ALL ON TABLE public.trades TO authenticated;
GRANT ALL ON TABLE public.trades TO service_role;


--
-- Name: TABLE user_favorite_instruments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_favorite_instruments TO anon;
GRANT ALL ON TABLE public.user_favorite_instruments TO authenticated;
GRANT ALL ON TABLE public.user_favorite_instruments TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict LYdY9QURDAnVfsYXXj235oAa5N6gveSm1PSQ51gs8vEMJ6Cgk0vSKOW6HWkoEF2

