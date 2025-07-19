const { Network, Alchemy } = require("alchemy-sdk");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { ethers } = require("ethers");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const threadSubscriptions = new Map(); // key = chatId:threadId → Set of tickers

// Commands
bot.setMyCommands([
  { command: "start", description: "Filter op een ticker" },
  { command: "stop", description: "Verwijder filter" },
  { command: "list", description: "Bekijk je filters" },
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

  bot.sendMessage(chatId, `✅ Alerts ingesteld voor *${ticker}*`, {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  });
});

// /stop <TICKER>
bot.onText(/\/stop\s+([^\s]+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const ticker = match[1].toUpperCase();
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  if (!threadSubscriptions.has(key)) {
    return bot.sendMessage(chatId, `⚠️ Geen actieve filters.`, {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  const subs = threadSubscriptions.get(key);
  const removed = subs.delete(ticker);

  const reply = removed
    ? `🛑 Filter *${ticker}* verwijderd.`
    : `⚠️ Geen filter voor *${ticker}* gevonden.`;

  bot.sendMessage(chatId, reply, {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  });
});

// /list
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;
  const subs = threadSubscriptions.get(key);

  if (subs && subs.size > 0) {
    const list = [...subs].map(t => `• ${t}`).join("\n");
    bot.sendMessage(chatId, `🎯 Actieve filters:\n${list}`, {
      parse_mode: "Markdown",
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  } else {
    bot.sendMessage(chatId, `🚫 Geen actieve filters.`, {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }
});

// Client setup
function getClientsForChain(chainId) {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const network = chainId === 1 ? Network.ETH_MAINNET : Network.BASE_MAINNET; // base disabled

  const alchemy = new Alchemy({ apiKey: alchemyKey, network });
  const rpcURL = chainId === 1
    ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const provider = new ethers.providers.JsonRpcProvider(rpcURL);
  return { alchemy, provider };
}

// LP lookup
async function getUniswapV2PairAddress(tokenAddress, provider, chainId) {
  const factoryABI = ["function getPair(address, address) external view returns (address)"];
  const WETH = chainId === 1
    ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    : "0x4200000000000000000000000000000000000006"; // base

  const factoryAddress = chainId === 1
    ? "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
    : "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"; // base aerodrome

  const factory = new ethers.Contract(factoryAddress, factoryABI, provider);
  try {
    const pair = await factory.getPair(tokenAddress, WETH);
    return pair !== ethers.constants.AddressZero ? pair : null;
  } catch {
    return null;
  }
}

// Core block scan
async function processBlock(blockNumber, chainId) {
  const { alchemy, provider } = getClientsForChain(chainId);

  let receipts;
  try {
    const res = await alchemy.core.getTransactionReceipts({ blockNumber: blockNumber.toString() });
    receipts = res.receipts || [];
  } catch (err) {
    console.error(`[${chainId}] ❌ Receipt fetch error:`, err.message);
    return;
  }

  for (let receipt of receipts) {
    const ca = receipt.contractAddress;
    if (!ca) continue;

    let symbol, name;
    try {
      const contract = new ethers.Contract(ca, [
        "function symbol() view returns (string)",
        "function name() view returns (string)"
      ], provider);
      symbol = await contract.symbol();
      name = await contract.name();
    } catch { continue; }

    console.log(`➡️  CA: ${ca} | Symbol: ${symbol}`);
    const symbolUpper = symbol.toUpperCase();
    const lpAddress = await getUniswapV2PairAddress(ca, provider, chainId);
    const hasLP = lpAddress && lpAddress !== ethers.constants.AddressZero;
    console.log(hasLP ? `💧 LP gevonden voor ${symbolUpper}: ${lpAddress}` : `💧 Geen LP voor ${symbolUpper}`);

    for (let [key, subs] of threadSubscriptions.entries()) {
      const [chatId, threadId] = key.split(":");
      if (![...subs].includes("ALL") && !subs.has(symbolUpper)) continue;
      const explorer = chainId === 1 ? "https://etherscan.io" : "https://basescan.org";
      const chainLabel = chainId === 1 ? "ethereum" : "base";
      const message = `🚨 *Token met ticker '${symbol}' gevonden!*\n\n*Token:* ${symbol} (${name})\n📬 \`${ca}\`\n🔗 [Etherscan](${explorer}/address/${ca})\n📈 [Dexscreener](${`https://dexscreener.com/${chainLabel}/${ca}`})\n💧 ${hasLP ? `LP gevonden: \`${lpAddress}\`` : `Geen LP gevonden`}`;

      const options = {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
      };

      bot.sendMessage(chatId, message, options);
    }
  }
}

// Ethereum scanner
function main() {
  const { alchemy } = getClientsForChain(1);
  alchemy.ws.on("block", (blockNumber) => processBlock(blockNumber, 1));

  // // Base uitgeschakeld, later heractiveren:
  // const { alchemy: baseAlchemy } = getClientsForChain(8453);
  // baseAlchemy.ws.on("block", (blockNumber) => processBlock(blockNumber, 8453));
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  main();
});
