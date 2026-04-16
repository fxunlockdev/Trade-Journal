const TELEGRAM_API_BASE = "https://api.telegram.org";

interface TelegramResponse {
  readonly ok: boolean;
  readonly message_id?: number;
  readonly description?: string;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: string = "Markdown",
): Promise<TelegramResponse> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Telegram API error (${response.status}): ${errorBody}`,
    );
  }

  const data = await response.json();

  return {
    ok: data.ok,
    message_id: data.result?.message_id,
    description: data.description,
  };
}

export async function editTelegramMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
  parseMode: string = "Markdown",
): Promise<TelegramResponse> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/editMessageText`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Telegram API error (${response.status}): ${errorBody}`,
    );
  }

  const data = await response.json();

  return {
    ok: data.ok,
    message_id: data.result?.message_id,
    description: data.description,
  };
}
