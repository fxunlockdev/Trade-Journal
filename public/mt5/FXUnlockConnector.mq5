//+------------------------------------------------------------------+
//|                                           FXUnlockConnector.mq5  |
//|                    FX Unlock Trade Journal — MT5 auto-sync EA    |
//|                                                                  |
//|  Setup (once):                                                   |
//|   1. Open this file in MetaEditor and press F7 to compile.       |
//|   2. MT5 → Tools → Options → Expert Advisors →                   |
//|      tick "Allow WebRequest for listed URL" and add your         |
//|      journal's URL (e.g. https://yourapp.vercel.app).            |
//|   3. Make sure the "Algo Trading" toolbar button is ON.          |
//|   4. Drag the EA onto ANY chart, set ServerUrl + ApiToken        |
//|      (generate the token in the app: Settings → MT5 Sync).       |
//|                                                                  |
//|  What it does: opens, SL/TP changes and closes (with your        |
//|  broker's real P&L) sync into your journal automatically.       |
//|  All requests are idempotent server-side — re-sends are safe.    |
//+------------------------------------------------------------------+
#property copyright "FX Unlock"
#property version   "1.00"
#property description "Auto-syncs trades into the FX Unlock Trade Journal."

input string InpServerUrl   = "https://yourapp.vercel.app"; // ServerUrl: journal base URL (no trailing slash)
input string InpApiToken    = "";                           // ApiToken: from Settings → MT5 Sync
input int    InpHistoryDays = 30;                           // HistoryDays: backfill window on attach (0 = off)

// Flush every 5s; every 12th tick (~60s) re-sync open positions and
// recently-closed positions so missed events self-heal without restart.
#define TIMER_SECONDS        5
#define RESYNC_EVERY_TICKS   12
#define RECENT_CLOSES_HOURS  2
#define MAX_BATCH            50
#define MAX_QUEUE            400
#define WEB_TIMEOUT_MS       5000

// Pending event queue. Events are serialized to JSON at enqueue time;
// OnTradeTransaction MUST stay fast and must never call WebRequest (it
// blocks the trade-event queue), so the timer does all network I/O.
string g_queue[];
int    g_timerTicks = 0;
bool   g_pingOk     = false;

//+------------------------------------------------------------------+
//| Small helpers                                                    |
//+------------------------------------------------------------------+
string JsonEscape(const string value)
  {
   string s = value;
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
  }

string Num(const double value)
  {
   return DoubleToString(value, 8);
  }

// Broker server time → UTC. DEAL_TIME is server-clock; the journal wants
// unix seconds UTC. Offset uses the CURRENT server↔GMT gap, which is
// slightly wrong for historical deals across a DST switch — acceptable.
long ToUtc(const datetime serverTime)
  {
   long offset = (long)TimeTradeServer() - (long)TimeGMT();
   return (long)serverTime - offset;
  }

string AccountLogin()   { return IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)); }
string AccountServer()  { return AccountInfoString(ACCOUNT_SERVER); }
string AccountBroker()  { return AccountInfoString(ACCOUNT_COMPANY); }
string AccountCcy()     { return AccountInfoString(ACCOUNT_CURRENCY); }

void Enqueue(const string eventJson)
  {
   int n = ArraySize(g_queue);
   if(n >= MAX_QUEUE)
     {
      // Drop oldest — the periodic re-sync self-heals anything lost.
      for(int i = 1; i < n; i++) g_queue[i - 1] = g_queue[i];
      n--;
      ArrayResize(g_queue, n);
     }
   ArrayResize(g_queue, n + 1);
   g_queue[n] = eventJson;
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
bool HttpRequest(const string method, const string path, const string body,
                 string &responseBody, int &statusCode)
  {
   string url     = InpServerUrl + path;
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpApiToken + "\r\n";

   char post[];
   if(StringLen(body) > 0)
     {
      StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8);
      // StringToCharArray appends a terminating '\0' — strip it or the JSON
      // body ends with a null byte the server can't parse.
      ArrayResize(post, StringLen(body));
     }

   char result[];
   string resultHeaders;
   ResetLastError();
   statusCode = WebRequest(method, url, headers, WEB_TIMEOUT_MS, post, result, resultHeaders);

   if(statusCode == -1)
     {
      Print("FXUnlock: WebRequest failed (error ", GetLastError(),
            "). Add ", InpServerUrl,
            " to Tools → Options → Expert Advisors → Allow WebRequest.");
      return false;
     }

   responseBody = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
  }

//+------------------------------------------------------------------+
//| Event JSON builders                                              |
//+------------------------------------------------------------------+
string OpenEventJson(const ulong positionId)
  {
   if(!PositionSelectByTicket(positionId)) return "";

   string direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);

   string json = "{\"type\":\"open\""
      + ",\"ticket\":" + IntegerToString((long)positionId)
      + ",\"symbol\":\"" + JsonEscape(PositionGetString(POSITION_SYMBOL)) + "\""
      + ",\"direction\":\"" + direction + "\""
      + ",\"volume\":" + Num(PositionGetDouble(POSITION_VOLUME))
      + ",\"entry_price\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN))
      + ",\"open_time\":" + IntegerToString(ToUtc((datetime)PositionGetInteger(POSITION_TIME)));
   if(sl > 0) json += ",\"sl\":" + Num(sl);
   if(tp > 0) json += ",\"tp\":" + Num(tp);
   json += "}";
   return json;
  }

string UpdateEventJson(const ulong positionId)
  {
   if(!PositionSelectByTicket(positionId)) return "";

   string direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);

   string json = "{\"type\":\"update\""
      + ",\"ticket\":" + IntegerToString((long)positionId)
      + ",\"symbol\":\"" + JsonEscape(PositionGetString(POSITION_SYMBOL)) + "\""
      + ",\"direction\":\"" + direction + "\""
      + ",\"volume\":" + Num(PositionGetDouble(POSITION_VOLUME))
      + ",\"entry_price\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN))
      + ",\"open_time\":" + IntegerToString(ToUtc((datetime)PositionGetInteger(POSITION_TIME)));
   if(sl > 0) json += ",\"sl\":" + Num(sl);
   if(tp > 0) json += ",\"tp\":" + Num(tp);
   json += "}";
   return json;
  }

// Cumulative close snapshot for a position. Aggregates ALL deals of the
// position (HistorySelectByPosition) so partial closes always send running
// totals — the server just overwrites, making replays and out-of-order
// delivery harmless. is_final flips once the position no longer exists.
string CloseEventJson(const ulong positionId)
  {
   if(!HistorySelectByPosition((long)positionId)) return "";

   int total = HistoryDealsTotal();
   if(total <= 0) return "";

   string symbol = "";
   string direction = "";
   double inVolume = 0, outVolume = 0;
   double inValue = 0, outValue = 0;   // for volume-weighted prices
   double profit = 0, commission = 0, swap = 0;
   double lastSl = 0, lastTp = 0;
   long   firstInTime = 0, lastOutTime = 0;

   for(int i = 0; i < total; i++)
     {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      long entry   = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      double vol   = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double price = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      long time    = (long)HistoryDealGetInteger(dealTicket, DEAL_TIME);

      profit     += HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      commission += HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      swap       += HistoryDealGetDouble(dealTicket, DEAL_SWAP);

      if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
        {
         if(firstInTime == 0 || time < firstInTime)
           {
            firstInTime = time;
            symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
            direction = (dealType == DEAL_TYPE_BUY) ? "buy" : "sell";
           }
         inVolume += vol;
         inValue  += vol * price;
        }
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         outVolume += vol;
         outValue  += vol * price;
         if(time >= lastOutTime)
           {
            lastOutTime = time;
            lastSl = HistoryDealGetDouble(dealTicket, DEAL_SL);
            lastTp = HistoryDealGetDouble(dealTicket, DEAL_TP);
           }
        }
     }

   if(symbol == "" || inVolume <= 0 || outVolume <= 0 || lastOutTime == 0) return "";

   double entryPrice = inValue / inVolume;
   double exitPrice  = outValue / outVolume;
   bool   isFinal    = !PositionSelectByTicket(positionId);

   string json = "{\"type\":\"close\""
      + ",\"ticket\":" + IntegerToString((long)positionId)
      + ",\"symbol\":\"" + JsonEscape(symbol) + "\""
      + ",\"direction\":\"" + direction + "\""
      + ",\"volume\":" + Num(inVolume)
      + ",\"entry_price\":" + Num(entryPrice)
      + ",\"open_time\":" + IntegerToString(ToUtc((datetime)firstInTime))
      + ",\"exit_price\":" + Num(exitPrice)
      + ",\"close_time\":" + IntegerToString(ToUtc((datetime)lastOutTime))
      + ",\"profit\":" + Num(profit)
      + ",\"commission\":" + Num(commission)
      + ",\"swap\":" + Num(swap)
      + ",\"closed_volume\":" + Num(outVolume)
      + ",\"is_final\":" + (isFinal ? "true" : "false");
   if(lastSl > 0) json += ",\"sl\":" + Num(lastSl);
   if(lastTp > 0) json += ",\"tp\":" + Num(lastTp);
   json += "}";
   return json;
  }

//+------------------------------------------------------------------+
//| Batch flush                                                      |
//+------------------------------------------------------------------+
void FlushQueue()
  {
   int n = ArraySize(g_queue);
   if(n == 0) return;

   int batchSize = MathMin(n, MAX_BATCH);
   string events = "";
   for(int i = 0; i < batchSize; i++)
     {
      if(i > 0) events += ",";
      events += g_queue[i];
     }

   string body = "{\"account\":\"" + AccountLogin() + "\""
      + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
      + ",\"broker\":\"" + JsonEscape(AccountBroker()) + "\""
      + ",\"currency\":\"" + JsonEscape(AccountCcy()) + "\""
      + ",\"events\":[" + events + "]}";

   string response;
   int status;
   if(!HttpRequest("POST", "/api/mt5/trades", body, response, status))
      return; // transport error — keep queue, retry next tick

   if(status == 200 || status == 201)
     {
      // Remove the sent slice; keep any overflow for the next tick.
      int remaining = n - batchSize;
      for(int i = 0; i < remaining; i++) g_queue[i] = g_queue[i + batchSize];
      ArrayResize(g_queue, remaining);
     }
   else if(status == 401 || status == 409)
     {
      // Auth/config problem — clear the queue to avoid spamming the server
      // and tell the user exactly what to do in the Experts log.
      Print("FXUnlock: server rejected the sync (HTTP ", status, "): ", response);
      ArrayResize(g_queue, 0);
     }
   else
     {
      Print("FXUnlock: sync failed (HTTP ", status, "), will retry: ", response);
     }
  }

//+------------------------------------------------------------------+
//| Re-sync + backfill                                               |
//+------------------------------------------------------------------+
void SyncOpenPositions()
  {
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      ulong positionId = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      string json = OpenEventJson(positionId);
      if(json != "") Enqueue(json);
     }
  }

// Send cumulative close snapshots for every position with OUT deals inside
// the window. Used for the initial backfill (InpHistoryDays) and for the
// rolling recent-closes self-heal (RECENT_CLOSES_HOURS).
void SyncClosedPositions(const datetime fromServerTime)
  {
   if(!HistorySelect(fromServerTime, TimeCurrent() + 60)) return;

   int total = HistoryDealsTotal();
   ulong seen[];

   for(int i = 0; i < total; i++)
     {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;

      ulong positionId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(positionId == 0) continue;

      bool alreadySeen = false;
      for(int s = 0; s < ArraySize(seen); s++)
         if(seen[s] == positionId) { alreadySeen = true; break; }
      if(alreadySeen) continue;

      int sn = ArraySize(seen);
      ArrayResize(seen, sn + 1);
      seen[sn] = positionId;

      // CloseEventJson re-selects history by position — refresh the window
      // selection afterwards so the outer deal loop keeps iterating correctly.
      string json = CloseEventJson(positionId);
      if(json != "") Enqueue(json);
      HistorySelect(fromServerTime, TimeCurrent() + 60);
     }
  }

//+------------------------------------------------------------------+
//| MT5 lifecycle                                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpApiToken) < 20)
     {
      Print("FXUnlock: set the ApiToken input (generate it in the app: Settings → MT5 Sync).");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      Print("FXUnlock: 'Algo Trading' is OFF — turn it on or nothing will sync.");

   // Handshake: verifies the token and pins this account server-side.
   string path = "/api/mt5/ping?account=" + AccountLogin()
      + "&server=" + AccountServer()
      + "&broker=" + AccountBroker();
   string response;
   int status;
   if(HttpRequest("GET", path, "", response, status))
     {
      if(status == 200)
        {
         g_pingOk = true;
         Print("FXUnlock: connected. ", response);
        }
      else
         Print("FXUnlock: handshake rejected (HTTP ", status, "): ", response);
     }

   // Initial sync: everything currently open + the backfill window.
   SyncOpenPositions();
   if(InpHistoryDays > 0)
      SyncClosedPositions(TimeCurrent() - (datetime)(InpHistoryDays * 86400));

   EventSetTimer(TIMER_SECONDS);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   FlushQueue(); // best-effort final flush
  }

void OnTimer()
  {
   g_timerTicks++;
   if(g_timerTicks % RESYNC_EVERY_TICKS == 0)
     {
      // Rolling self-heal: open positions + recent closes. Idempotent
      // server-side, so double-sends simply converge.
      SyncOpenPositions();
      SyncClosedPositions(TimeCurrent() - (datetime)(RECENT_CLOSES_HOURS * 3600));
     }
   FlushQueue();
  }

// Only enqueue here — never do network I/O inside OnTradeTransaction, it
// blocks MT5's trade-event queue and events get silently dropped when full.
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
     {
      if(!HistoryDealSelect(trans.deal)) return;

      long dealType = HistoryDealGetInteger(trans.deal, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) return;

      ulong positionId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
      if(positionId == 0) return;

      long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN)
        {
         string json = OpenEventJson(positionId);
         if(json != "") Enqueue(json);
        }
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         string json = CloseEventJson(positionId);
         if(json != "") Enqueue(json);
        }
     }
   else if(trans.type == TRADE_TRANSACTION_POSITION)
     {
      // SL/TP modification on an existing position.
      string json = UpdateEventJson(trans.position);
      if(json != "") Enqueue(json);
     }
  }
//+------------------------------------------------------------------+
