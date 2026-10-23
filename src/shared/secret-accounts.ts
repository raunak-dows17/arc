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
  googleProviderApiKey: "provider.google.api-key",
  groqProviderApiKey: "provider.groq.api-key",
  openrouterProviderApiKey: "provider.openrouter.api-key",
  cerebrasProviderApiKey: "provider.cerebras.api-key",
  mistralProviderApiKey: "provider.mistral.api-key",
  githubProviderApiKey: "provider.github.api-key",
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
  [SECRET_ACCOUNTS.googleProviderApiKey]:
    "Google Gemini API key. Create one at https://aistudio.google.com/app/apikey.",
  [SECRET_ACCOUNTS.groqProviderApiKey]:
    "Groq API key. Create one at https://console.groq.com/keys.",
  [SECRET_ACCOUNTS.openrouterProviderApiKey]:
    "OpenRouter API key. Create one at https://openrouter.ai/keys.",
  [SECRET_ACCOUNTS.cerebrasProviderApiKey]:
    "Cerebras Cloud API key. Create one at https://cloud.cerebras.ai/.",
  [SECRET_ACCOUNTS.mistralProviderApiKey]:
    "Mistral API key. Create one at https://console.mistral.ai/api-keys/.",
  [SECRET_ACCOUNTS.githubProviderApiKey]:
    "GitHub token with Models access. Create one at https://github.com/settings/tokens.",
};

export const KNOWN_SECRET_ACCOUNTS = Object.values(SECRET_ACCOUNTS);
