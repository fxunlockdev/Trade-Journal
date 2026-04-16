interface TelegramSendResponse {
  readonly ok: boolean;
  readonly message_id?: number;
}

interface TelegramEditResponse {
  readonly ok: boolean;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResponse> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${data.description ?? "Unknown error"}`,
    );
  }

  return {
    ok: true,
    message_id: data.result?.message_id,
  };
}

export async function editTelegramMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<TelegramEditResponse> {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram editMessageText failed: ${data.description ?? "Unknown error"}`,
    );
  }

  return { ok: true };
}
