/**
 * Stable OS-keyring account names. Secrets themselves never live in source,
 * `.env`, memory, prompts, or the audit log.
 */
export const SECRET_ACCOUNTS = {
  braveApiKey: "brave.api-key",
  gmailAppPassword: "gmail.app-password",
  telegramBotToken: "telegram.bot-token",
  youtubeApiKey: "youtube.api-key",
  instagramAccessToken: "instagram.access-token",
} as const;

export type SecretAccount =
  (typeof SECRET_ACCOUNTS)[keyof typeof SECRET_ACCOUNTS];

export const SECRET_ACCOUNT_HELP: Readonly<Record<string, string>> = {
  [SECRET_ACCOUNTS.braveApiKey]:
    "Brave Search API key (free tier) for web_search. Create one at https://brave.com/search/api/.",
  [SECRET_ACCOUNTS.gmailAppPassword]:
    "Google app password for read-only Gmail IMAP. Enable 2-Step Verification, enable IMAP in Gmail, then create an app password at https://myaccount.google.com/apppasswords.",
  [SECRET_ACCOUNTS.telegramBotToken]:
    "Telegram bot token from @BotFather for remote chat and notifications. Use /newbot, then copy the token. Find your numeric chat id with the Bot API getUpdates endpoint.",
  [SECRET_ACCOUNTS.youtubeApiKey]:
    "YouTube Data API key for read-only channel and video analysis.",
  [SECRET_ACCOUNTS.instagramAccessToken]:
    "Instagram professional-account access token for read-only insights.",
};

export const KNOWN_SECRET_ACCOUNTS = Object.values(SECRET_ACCOUNTS);
