// Telegram Token Scanner Bot with Ticker-Only Filtering (Ethereum only)

const { Network, Alchemy } = require("alchemy-sdk");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const threadSubscriptions = new Map(); // key = chatId:threadId -> Set of tickers

bot.setMyCommands([
  { command: "start", description: "Subscribe to alerts for a ticker or 'ALL'" },
  { command: "stop", description: "Unsubscribe from a ticker" },
  { command: "list", description: "List your current filters" },
]);

// /start <TICKER>
bot.onText(/\/start\s+([^\s]+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const ticker = match[1].toUpperCase();
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  if (!threadSubscriptions.has(key)) {
    threadSubscriptions.set(key, new Set());
  }

  threadSubscriptions.get(key).add(ticker);

  bot.sendMessage(chatId, `✅ Alerts activated for *${ticker}*`, {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  });

  console.log(`🟢 Subscribed to ${ticker} for ${key}`);
});

// /stop <TICKER>
bot.onText(/\/stop\s+([^\s]+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const ticker = match[1].toUpperCase();
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  const subs = threadSubscriptions.get(key);
  if (!subs || !subs.has(ticker)) {
    return bot.sendMessage(chatId, `⚠️ No filter for *${ticker}* found.`, {
      parse_mode: "Markdown",
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  subs.delete(ticker);
  bot.sendMessage(chatId, `🛑 Unsubscribed from *${ticker}*`, {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  });

  console.log(`🔴 Unsubscribed from ${ticker} for ${key}`);
});

// /list
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;
  const subs = threadSubscriptions.get(key);

  if (!subs || subs.size === 0) {
    return bot.sendMessage(chatId, `🚫 No active filters.`, {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  const list = [...subs].map(t => `• ${t}`).join("\n");
  bot.sendMessage(chatId, `🎯 Active filters:\n${list}`, {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  });
});

// Ethereum client setup
function getClients() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  const alchemy = new Alchemy({ apiKey, network: Network.ETH_MAINNET });
  const provider = new ethers.providers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`);
  return { alchemy, provider };
}

// LP check
async function getUniswapV2PairAddress(token, provider) {
  const factory = new ethers.Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    ["function getPair(address, address) external view returns (address)"],
    provider
  );

  try {
    const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const pair = await factory.getPair(token, WETH);
    return pair !== ethers.constants.AddressZero ? pair : null;
  } catch {
    return null;
  }
}

// Main block processor
async function processBlock(blockNumber) {
  const { alchemy, provider } = getClients();
  console.log(`📦 Processing block ${blockNumber}...`);

  let receipts = [];

  try {
    const res = await alchemy.core.getTransactionReceipts({ blockNumber: blockNumber.toString() });
    receipts = res?.receipts || [];
    if (!Array.isArray(receipts)) {
      console.warn(`⚠️ Unexpected response format:`, res);
      return;
    }
  } catch (err) {
    console.error(`❌ Error fetching receipts for block ${blockNumber}:`, err.message);
    return;
  }

  for (let tx of receipts) {
    const ca = tx.contractAddress;
    if (!ca) continue;

    let symbol, name;
    try {
      const contract = new ethers.Contract(ca, [
        "function symbol() view returns (string)",
        "function name() view returns (string)"
      ], provider);
      symbol = await contract.symbol();
      name = await contract.name();
    } catch (err) {
      console.warn(`⚠️ Could not read symbol/name for ${ca}:`, err.message);
      continue;
    }

    if (!symbol) continue;
    const upperSymbol = symbol.toUpperCase();
    console.log(`\n🔍 New token deployed`);
    console.log(`📛 Symbol: ${upperSymbol}`);
    console.log(`📬 Address: ${ca}`);
    console.log(`📛 Name: ${name}`);

    const lpAddress = await getUniswapV2PairAddress(ca, provider);
    const hasLP = !!lpAddress;
    console.log(hasLP ? `💧 LP Found: ${lpAddress}` : `💧 No LP Found`);

    for (let [key, subs] of threadSubscriptions.entries()) {
      const [chatId, threadId] = key.split(":");

      for (let ticker of subs) {
        const isMatch = upperSymbol === ticker;
        const isAllMode = ticker === "ALL";

        console.log(`🔎 Checking ${upperSymbol} against subscription '${ticker}' → Match: ${isMatch} | All Mode: ${isAllMode}`);

        if (!isMatch && !isAllMode) continue;

        const message = `🚨 *New Token Detected!*

*Token:* ${symbol} (${name})
📬 \`${ca}\`
🔗 [Etherscan](https://etherscan.io/address/${ca})
📈 [Dexscreener](https://dexscreener.com/ethereum/${ca})
💧 ${hasLP ? `LP Found: \`${lpAddress}\`` : `No LP`}`;

        const options = {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
        };

        bot.sendMessage(chatId, message, options);
        console.log(`📨 Alert sent to chat ${chatId} for '${ticker}' (thread: ${threadId})`);
      }
    }
  }
}


function main() {
  const { alchemy } = getClients();
  alchemy.ws.on("block", processBlock);
}

app.listen(port, () => {
  console.log(`🚀 Bot live on port ${port}`);
  main();
});
