/**
 * pi-ai-client — @mariozechner/pi-ai Node.js kütüphanesi wrapper'ı
 *
 * Express sunucusu yerine doğrudan kütüphaneyi kullanır.
 *
 * Kurulum:
 *   npm install @mariozechner/pi-ai
 *
 * Kullanım:
 *   import { PiAiClient } from "./pi-ai-client.js";
 *
 *   const client = new PiAiClient({ accounts: [...] });
 *
 *   // Tek seferlik yanıt
 *   const reply = await client.complete("Merhaba, nasılsın?");
 *   console.log(reply.content);
 *
 *   // Streaming
 *   for await (const chunk of client.stream("Bana bir hikaye anlat")) {
 *     process.stdout.write(chunk);
 *   }
 *
 *   // Çok turlu sohbet
 *   const chat = client.createChat({ systemPrompt: "Sen yardımcı bir asistansın." });
 *   await chat.send("Merhaba!");
 *   await chat.send("Peki ya hava durumu?");
 *   console.log(chat.getHistory());
 */

import { readFileSync, existsSync } from "fs";
import { getModel, stream as piStream, complete as piComplete } from "@mariozechner/pi-ai";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";

// ═══════════════════════════════════════════════════════════════════════════════
//  HESAP YÖNETİCİSİ
// ═══════════════════════════════════════════════════════════════════════════════

class AccountManager {
  #accounts;
  #counters = new Map();
  #authData = {};

  constructor(accounts, authFile = "./auth.json") {
    this.#accounts = accounts;
    this.#loadAuth(authFile);
  }

  #loadAuth(authFile) {
    if (existsSync(authFile)) {
      try {
        this.#authData = JSON.parse(readFileSync(authFile, "utf-8"));
        console.log(`[auth] ${authFile} yüklendi.`);
      } catch (e) {
        console.warn(`[auth] ${authFile} okunamadı:`, e.message);
      }
    } else {
      console.warn(`[auth] ${authFile} bulunamadı — OAuth hesapları çalışmayacak.`);
    }
  }

  async getAccount(requestedModel) {
    const candidates = this.#findCandidates(requestedModel);

    if (candidates.length === 0) {
      throw new Error(
        `'${requestedModel}' için uygun hesap bulunamadı. ` +
        `Mevcut hesaplar: ${this.#accounts.map(a => a.label).join(", ")}`
      );
    }

    // Round-robin: en az kullanılan hesabı seç
    candidates.sort((a, b) => {
      const cA = this.#counters.get(a.label) ?? 0;
      const cB = this.#counters.get(b.label) ?? 0;
      return cA - cB;
    });

    const account = candidates[0];
    this.#counters.set(account.label, (this.#counters.get(account.label) ?? 0) + 1);

    const apiKey = await this.#resolveApiKey(account);
    return { account, apiKey };
  }

  #findCandidates(requestedModel) {
    if (requestedModel.includes("/")) {
      const [prov, mid] = requestedModel.split("/");
      return this.#accounts.filter(
        a => a.provider === prov && (a.modelId === mid || !mid)
      );
    }
    return this.#accounts.filter(a => a.modelId === requestedModel);
  }

  async #resolveApiKey(account) {
    if (account.apiKey) return account.apiKey;

    if (account.oauthKey) {
      const result = await getOAuthApiKey(account.oauthKey, this.#authData);
      if (!result) {
        throw new Error(
          `'${account.label}' için OAuth token alınamadı. ` +
          `Lütfen 'npx @mariozechner/pi-ai login ${account.oauthKey}' komutunu çalıştırın.`
        );
      }
      this.#authData[account.oauthKey] = { type: "oauth", ...result.newCredentials };
      return result.apiKey;
    }

    return undefined;
  }

  getStats() {
    return Object.fromEntries(this.#counters);
  }

  getAccounts() {
    return this.#accounts;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  YARDIMCI DÖNÜŞÜM FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sohbet geçmişini pi-ai Context formatına dönüştürür.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [systemPrompt]
 * @returns {{ systemPrompt?: string, messages: Array }}
 */
function buildContext(messages, systemPrompt) {
  const piMessages = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        piMessages.push({ role: "user", content: msg.content, timestamp: Date.now() });
      } else if (Array.isArray(msg.content)) {
        // Multimodal içerik (image_url vb.)
        const blocks = msg.content.map(part => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "image_url") {
            const url = part.image_url?.url ?? "";
            if (url.startsWith("data:")) {
              const [header, data] = url.split(",");
              const mimeType = header.replace("data:", "").replace(";base64", "");
              return { type: "image", data, mimeType };
            }
            return { type: "text", text: `[image: ${url}]` };
          }
          return { type: "text", text: JSON.stringify(part) };
        });
        piMessages.push({ role: "user", content: blocks, timestamp: Date.now() });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        piMessages.push({
          role      : "assistant",
          content   : [{ type: "text", text: msg.content }],
          stopReason: "stop",
          usage     : { input: 0, output: 0, cost: { input: 0, output: 0, total: 0 } },
          timestamp : Date.now(),
        });
      }
    }
  }

  return { systemPrompt, messages: piMessages };
}

/**
 * pi-ai AssistantMessage'ı okunabilir metin + meta verisine dönüştürür.
 * @param {object} message
 * @returns {{ content: string, stopReason: string, usage: object }}
 */
function parseAssistantMessage(message) {
  let content = "";
  for (const block of message.content ?? []) {
    if (block.type === "text") content += block.text;
    else if (block.type === "thinking") content += `<thinking>${block.thinking}</thinking>`;
  }
  return {
    content,
    stopReason: message.stopReason ?? "stop",
    usage: {
      inputTokens : message?.usage?.input  ?? 0,
      outputTokens: message?.usage?.output ?? 0,
      cost        : message?.usage?.cost?.total ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SOHBET OTURUMU
// ═══════════════════════════════════════════════════════════════════════════════

class Chat {
  #client;
  #history   = [];
  #systemPrompt;
  #modelId;

  /**
   * @param {PiAiClient} client
   * @param {{ systemPrompt?: string, modelId?: string }} opts
   */
  constructor(client, opts = {}) {
    this.#client       = client;
    this.#systemPrompt = opts.systemPrompt;
    this.#modelId      = opts.modelId;
  }

  /**
   * Kullanıcı mesajı gönderir, yanıtı geçmişe ekler ve döndürür.
   * @param {string} userMessage
   * @returns {Promise<{ content: string, stopReason: string, usage: object }>}
   */
  async send(userMessage) {
    this.#history.push({ role: "user", content: userMessage });

    const reply = await this.#client.complete(this.#history, {
      systemPrompt: this.#systemPrompt,
      modelId     : this.#modelId,
    });

    this.#history.push({ role: "assistant", content: reply.content });
    return reply;
  }

  /**
   * Kullanıcı mesajı gönderir ve yanıtı stream olarak döndürür.
   * @param {string} userMessage
   * @returns {AsyncGenerator<string>}
   */
  async *stream(userMessage) {
    this.#history.push({ role: "user", content: userMessage });

    let fullContent = "";
    for await (const chunk of this.#client.stream(this.#history, {
      systemPrompt: this.#systemPrompt,
      modelId     : this.#modelId,
    })) {
      fullContent += chunk;
      yield chunk;
    }

    this.#history.push({ role: "assistant", content: fullContent });
  }

  /** Sohbet geçmişini temizler */
  reset() {
    this.#history = [];
  }

  /** Mevcut sohbet geçmişini döndürür */
  getHistory() {
    return [...this.#history];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANA İSTEMCİ SINIFI
// ═══════════════════════════════════════════════════════════════════════════════

export class PiAiClient {
  #manager;
  #defaultModelId;

  /**
   * @param {{
   *   accounts: Array<{
   *     provider: string,
   *     modelId: string,
   *     label: string,
   *     apiKey?: string,
   *     oauthKey?: string,
   *   }>,
   *   defaultModelId?: string,
   *   authFile?: string,
   * }} opts
   */
  constructor(opts = {}) {
    const {
      accounts       = [],
      defaultModelId,
      authFile       = "./auth.json",
    } = opts;

    if (accounts.length === 0) {
      throw new Error("En az bir hesap tanımlanmalıdır.");
    }

    this.#manager        = new AccountManager(accounts, authFile);
    this.#defaultModelId = defaultModelId ?? accounts[0].modelId;
  }

  // ── complete ────────────────────────────────────────────────────────────────

  /**
   * Tek seferlik (non-streaming) tamamlama yapar.
   *
   * @param {string | Array<{role: string, content: string}>} input
   *   Tek satır metin veya tam sohbet geçmişi
   * @param {{
   *   modelId?: string,
   *   systemPrompt?: string,
   *   maxTokens?: number,
   *   apiKey?: string,
   * }} [opts]
   * @returns {Promise<{ content: string, stopReason: string, usage: object, account: string }>}
   */
  async complete(input, opts = {}) {
    const messages      = typeof input === "string"
      ? [{ role: "user", content: input }]
      : input;

    const modelId       = opts.modelId ?? this.#defaultModelId;
    const { account, apiKey } = await this.#manager.getAccount(modelId);

    const piModel = this.#getModel(account);
    const context = buildContext(messages, opts.systemPrompt);

    const callOpts = {
      ...(apiKey          && { apiKey }),
      ...(opts.maxTokens  && { maxTokens: opts.maxTokens }),
    };

    console.log(`[complete] ${account.label} → "${modelId}"`);

    const message = await piComplete(piModel, context, callOpts);
    const result  = parseAssistantMessage(message);

    return { ...result, account: account.label };
  }

  // ── stream ──────────────────────────────────────────────────────────────────

  /**
   * Streaming tamamlama — metin parçalarını yield eder.
   *
   * @param {string | Array<{role: string, content: string}>} input
   * @param {{
   *   modelId?: string,
   *   systemPrompt?: string,
   *   maxTokens?: number,
   * }} [opts]
   * @yields {string} Metin parçaları
   */
  async *stream(input, opts = {}) {
    const messages      = typeof input === "string"
      ? [{ role: "user", content: input }]
      : input;

    const modelId       = opts.modelId ?? this.#defaultModelId;
    const { account, apiKey } = await this.#manager.getAccount(modelId);

    const piModel = this.#getModel(account);
    const context = buildContext(messages, opts.systemPrompt);

    const callOpts = {
      ...(apiKey          && { apiKey }),
      ...(opts.maxTokens  && { maxTokens: opts.maxTokens }),
    };

    console.log(`[stream] ${account.label} → "${modelId}"`);

    const s = piStream(piModel, context, callOpts);

    for await (const event of s) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        yield event.delta;
      } else if (event.type === "error") {
        throw new Error(event.error?.errorMessage ?? "Bilinmeyen stream hatası");
      }
      // "done" eventi: stream tamamlandı, döngü zaten bitiyor
    }
  }

  // ── createChat ──────────────────────────────────────────────────────────────

  /**
   * Çok turlu sohbet oturumu başlatır.
   *
   * @param {{
   *   systemPrompt?: string,
   *   modelId?: string,
   * }} [opts]
   * @returns {Chat}
   */
  createChat(opts = {}) {
    return new Chat(this, {
      systemPrompt: opts.systemPrompt,
      modelId     : opts.modelId ?? this.#defaultModelId,
    });
  }

  // ── listAccounts ────────────────────────────────────────────────────────────

  /** Tanımlı hesapların listesini döndürür */
  listAccounts() {
    return this.#manager.getAccounts().map(a => ({
      label   : a.label,
      provider: a.provider,
      modelId : a.modelId,
      requests: this.#manager.getStats()[a.label] ?? 0,
    }));
  }

  // ── Özel yardımcı ───────────────────────────────────────────────────────────

  #getModel(account) {
    try {
      return getModel(account.provider, account.modelId);
    } catch {
      throw new Error(
        `Model '${account.provider}/${account.modelId}' bulunamadı.`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HAZIR HESAP ŞABLONLARI (isteğe bağlı)
// ═══════════════════════════════════════════════════════════════════════════════

export const AccountPresets = {
  geminiCli: (label = "gemini-cli-1") => ({
    provider : "google-gemini-cli",
    modelId  : "gemini-2.5-flash",
    oauthKey : "google-gemini-cli",
    label,
  }),

  anthropicOAuth: (label = "claude-1") => ({
    provider : "anthropic",
    modelId  : "claude-sonnet-4-20250514",
    oauthKey : "anthropic",
    label,
  }),

  anthropicKey: (apiKey, label = "claude-1") => ({
    provider: "anthropic",
    modelId : "claude-sonnet-4-20250514",
    apiKey,
    label,
  }),

  openai: (apiKey, label = "gpt4o-1") => ({
    provider: "openai",
    modelId : "gpt-4o",
    apiKey,
    label,
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  KULLANIM ÖRNEKLERİ
// ═══════════════════════════════════════════════════════════════════════════════
//
// ── Temel kullanım ────────────────────────────────────────────────────────────
//
//   import { PiAiClient, AccountPresets } from "./pi-ai-client.js";
//
//   const client = new PiAiClient({
//     accounts: [
//       AccountPresets.geminiCli(),
//       // AccountPresets.anthropicOAuth(),
//       // AccountPresets.openai(process.env.OPENAI_API_KEY),
//     ],
//   });
//
// ── Tek seferlik yanıt ────────────────────────────────────────────────────────
//
//   const reply = await client.complete("Türkiye'nin başkenti neresi?");
//   console.log(reply.content);
//   // → "Türkiye'nin başkenti Ankara'dır."
//
// ── Streaming ─────────────────────────────────────────────────────────────────
//
//   for await (const chunk of client.stream("Bana kısa bir hikaye anlat.")) {
//     process.stdout.write(chunk);
//   }
//   console.log();
//
// ── Çok turlu sohbet ──────────────────────────────────────────────────────────
//
//   const chat = client.createChat({
//     systemPrompt: "Sen yardımsever bir Türkçe asistansın.",
//   });
//
//   const r1 = await chat.send("Merhaba!");
//   console.log("Asistan:", r1.content);
//
//   const r2 = await chat.send("Bugün hava nasıl olacak?");
//   console.log("Asistan:", r2.content);
//
//   console.log("Geçmiş:", chat.getHistory());
//
// ── Sohbet + streaming ────────────────────────────────────────────────────────
//
//   const chat2 = client.createChat();
//   process.stdout.write("Asistan: ");
//   for await (const chunk of chat2.stream("Merhaba!")) {
//     process.stdout.write(chunk);
//   }
//   console.log();
//
// ── Çoklu hesap (round-robin) ─────────────────────────────────────────────────
//
//   const multiClient = new PiAiClient({
//     accounts: [
//       AccountPresets.geminiCli("gemini-1"),
//       AccountPresets.geminiCli("gemini-2"),   // ikinci OAuth hesabı
//     ],
//   });
//
//   // İstekler otomatik olarak gemini-1 ve gemini-2 arasında dağıtılır
//   await Promise.all([
//     multiClient.complete("Soru 1"),
//     multiClient.complete("Soru 2"),
//     multiClient.complete("Soru 3"),
//   ]);
//
//   console.log(multiClient.listAccounts());
//   // → [{ label: "gemini-1", requests: 2 }, { label: "gemini-2", requests: 1 }]
