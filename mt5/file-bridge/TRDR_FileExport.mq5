//+------------------------------------------------------------------+
//|                                           TRDR_FileExport.mq5    |
//|                        Writes closed trades to a JSON file       |
//|         A separate script (watcher) picks them up and sends      |
//+------------------------------------------------------------------+
#property copyright "TRDR"
#property version   "1.00"
#property description "Exports closed trades to JSON file for TRDR sync"

//--- Input Parameters
input string   OutputFile = "trdr_trades.json";  // Output filename (in MQL5/Files/)
input int      CheckIntervalSec = 10;            // Check interval in seconds

//--- Globals
int lastKnownDeals = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   Print("TRDR File Export EA initialized");
   Print("Output file: ", OutputFile);

   HistorySelect(0, TimeCurrent());
   lastKnownDeals = HistoryDealsTotal();

   EventSetTimer(CheckIntervalSec);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   CheckAndExport();
}

//+------------------------------------------------------------------+
void OnTrade()
{
   Sleep(1000);
   CheckAndExport();
}

//+------------------------------------------------------------------+
void CheckAndExport()
{
   HistorySelect(0, TimeCurrent());
   int totalDeals = HistoryDealsTotal();

   if(totalDeals <= lastKnownDeals)
      return;

   string tradesJson = "[";
   bool first = true;

   for(int i = lastKnownDeals; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT) continue;

      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      // Find entry deal
      long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      double openPrice = 0;
      datetime openTime = 0;
      string direction = "";

      // Search for the entry
      HistorySelect(0, TimeCurrent());
      int allDeals = HistoryDealsTotal();
      for(int j = 0; j < allDeals; j++)
      {
         ulong entryTicket = HistoryDealGetTicket(j);
         if(entryTicket == 0) continue;
         if(HistoryDealGetInteger(entryTicket, DEAL_POSITION_ID) != positionId) continue;
         if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(entryTicket, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;

         openPrice = HistoryDealGetDouble(entryTicket, DEAL_PRICE);
         openTime = (datetime)HistoryDealGetInteger(entryTicket, DEAL_TIME);
         direction = ((ENUM_DEAL_TYPE)HistoryDealGetInteger(entryTicket, DEAL_TYPE) == DEAL_TYPE_BUY) ? "buy" : "sell";
         break;
      }

      if(openPrice == 0) continue;

      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      datetime closeTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      double swap = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
      double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);

      if(!first) tradesJson += ",";
      first = false;

      tradesJson += "{";
      tradesJson += "\"instrument\":\"" + symbol + "\",";
      tradesJson += "\"type\":\"" + direction + "\",";
      tradesJson += "\"open_price\":" + DoubleToString(openPrice, 5) + ",";
      tradesJson += "\"close_price\":" + DoubleToString(closePrice, 5) + ",";
      tradesJson += "\"open_time\":\"" + TimeToString(openTime, TIME_DATE|TIME_SECONDS) + "\",";
      tradesJson += "\"close_time\":\"" + TimeToString(closeTime, TIME_DATE|TIME_SECONDS) + "\",";
      tradesJson += "\"volume\":" + DoubleToString(volume, 2) + ",";
      tradesJson += "\"commission\":" + DoubleToString(commission, 2) + ",";
      tradesJson += "\"swap\":" + DoubleToString(swap, 2) + ",";
      tradesJson += "\"profit\":" + DoubleToString(profit, 2);
      tradesJson += "}";
   }

   tradesJson += "]";

   if(!first) // Only write if we have trades
   {
      int handle = FileOpen(OutputFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(handle != INVALID_HANDLE)
      {
         FileWriteString(handle, tradesJson);
         FileClose(handle);
         Print("TRDR: Wrote ", totalDeals - lastKnownDeals, " new trades to ", OutputFile);
      }
      else
      {
         Print("TRDR: Failed to open file: ", OutputFile);
      }
   }

   lastKnownDeals = totalDeals;
}
//+------------------------------------------------------------------+
