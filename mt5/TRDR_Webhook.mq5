//+------------------------------------------------------------------+
//|                                              TRDR_Webhook.mq5    |
//|                                   TRDR Trading Command Center    |
//|                         Sends trade events to TRDR via webhook   |
//+------------------------------------------------------------------+
#property copyright "TRDR"
#property version   "1.00"
#property description "Sends closed trades to TRDR Trading Journal"

#include <Trade\Trade.mqh>

//--- Input Parameters (configure these)
input string   WebhookURL     = "https://your-vercel-domain.com/api/mt5";  // Your TRDR webhook URL
input string   WebhookSecret  = "trdr-mt5-webhook-secret-change-me";       // Must match MT5_WEBHOOK_SECRET
input string   UserID         = "your-supabase-user-id";                   // Your Supabase user ID
input int      RetryAttempts  = 3;                                          // Retry on failure
input int      RetryDelayMs   = 2000;                                       // Delay between retries (ms)

//--- Global variables
int lastKnownDeals = 0;
datetime lastCheck = 0;

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("TRDR Webhook EA initialized");
   Print("Webhook URL: ", WebhookURL);
   Print("User ID: ", UserID);

   // Count existing deals so we only send NEW ones
   HistorySelect(0, TimeCurrent());
   lastKnownDeals = HistoryDealsTotal();
   lastCheck = TimeCurrent();

   // Set timer to check every 5 seconds
   EventSetTimer(5);

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("TRDR Webhook EA stopped");
}

//+------------------------------------------------------------------+
//| Timer event - check for new closed trades                        |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckForNewDeals();
}

//+------------------------------------------------------------------+
//| Trade event - triggered on any trade activity                    |
//+------------------------------------------------------------------+
void OnTrade()
{
   // Small delay to let MT5 finalize the deal
   Sleep(1000);
   CheckForNewDeals();
}

//+------------------------------------------------------------------+
//| Check for new completed deals                                     |
//+------------------------------------------------------------------+
void CheckForNewDeals()
{
   // Select full history
   HistorySelect(0, TimeCurrent());
   int totalDeals = HistoryDealsTotal();

   if(totalDeals <= lastKnownDeals)
      return;

   // Process new deals
   for(int i = lastKnownDeals; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      // Only process closed trades (DEAL_ENTRY_OUT = exit/close)
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT) continue;

      // Skip balance/credit operations
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      // Get the matching entry deal to find open price/time
      long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);

      double openPrice = 0;
      datetime openTime = 0;
      string direction = "";

      // Find the opening deal for this position
      for(int j = 0; j < totalDeals; j++)
      {
         ulong entryTicket = HistoryDealGetTicket(j);
         if(entryTicket == 0) continue;

         long entryPosId = HistoryDealGetInteger(entryTicket, DEAL_POSITION_ID);
         ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(entryTicket, DEAL_ENTRY);

         if(entryPosId == positionId && entryType == DEAL_ENTRY_IN)
         {
            openPrice = HistoryDealGetDouble(entryTicket, DEAL_PRICE);
            openTime = (datetime)HistoryDealGetInteger(entryTicket, DEAL_TIME);

            ENUM_DEAL_TYPE entryDealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(entryTicket, DEAL_TYPE);
            direction = (entryDealType == DEAL_TYPE_BUY) ? "buy" : "sell";
            break;
         }
      }

      // Get close deal data
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      datetime closeTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      double swap = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
      double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);

      // Skip if we couldn't find the opening deal
      if(openPrice == 0 || direction == "")
      {
         Print("TRDR: Could not find opening deal for position ", positionId);
         continue;
      }

      // Send to webhook
      SendTradeToWebhook(symbol, direction, openPrice, closePrice,
                          openTime, closeTime, volume, commission, swap, profit);
   }

   lastKnownDeals = totalDeals;
}

//+------------------------------------------------------------------+
//| Send a single trade to the TRDR webhook                          |
//+------------------------------------------------------------------+
void SendTradeToWebhook(string symbol, string direction, double openPrice,
                         double closePrice, datetime openTime, datetime closeTime,
                         double volume, double commission, double swap, double profit)
{
   // Build JSON payload
   string json = "{\"trades\":[{";
   json += "\"instrument\":\"" + symbol + "\",";
   json += "\"type\":\"" + direction + "\",";
   json += "\"open_price\":" + DoubleToString(openPrice, 5) + ",";
   json += "\"close_price\":" + DoubleToString(closePrice, 5) + ",";
   json += "\"open_time\":\"" + TimeToString(openTime, TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"close_time\":\"" + TimeToString(closeTime, TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"volume\":" + DoubleToString(volume, 2) + ",";
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2);
   json += "}]}";

   Print("TRDR: Sending trade - ", symbol, " ", direction, " P&L: ", profit);

   // Send with retries
   for(int attempt = 1; attempt <= RetryAttempts; attempt++)
   {
      int result = SendHTTPPost(json);

      if(result == 200 || result == 201)
      {
         Print("TRDR: Trade sent successfully (", symbol, " ", direction, ")");
         return;
      }

      Print("TRDR: Attempt ", attempt, "/", RetryAttempts, " failed (HTTP ", result, ")");

      if(attempt < RetryAttempts)
         Sleep(RetryDelayMs);
   }

   Print("TRDR: FAILED to send trade after ", RetryAttempts, " attempts");
}

//+------------------------------------------------------------------+
//| Send HTTP POST request                                            |
//+------------------------------------------------------------------+
int SendHTTPPost(string jsonBody)
{
   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + WebhookSecret + "\r\n";
   headers += "x-user-id: " + UserID + "\r\n";

   char postData[];
   char resultData[];
   string resultHeaders;

   StringToCharArray(jsonBody, postData, 0, WHOLE_ARRAY, CP_UTF8);

   // Remove null terminator
   ArrayResize(postData, ArraySize(postData) - 1);

   int timeout = 10000; // 10 seconds

   int statusCode = WebRequest(
      "POST",
      WebhookURL,
      headers,
      timeout,
      postData,
      resultData,
      resultHeaders
   );

   if(statusCode == -1)
   {
      int errorCode = GetLastError();
      Print("TRDR: WebRequest error: ", errorCode);
      Print("TRDR: Make sure URL is allowed in Tools > Options > Expert Advisors");
      return -1;
   }

   return statusCode;
}
//+------------------------------------------------------------------+
