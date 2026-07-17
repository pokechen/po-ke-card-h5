#!/usr/bin/env node
/**
 * 从小程序项目的卡牌数据 (po-ke-card-wechat-game/shared/data/zhangyu_cards.js)
 * 生成 H5 项目所需的 docs/gwent_cards.json。
 *
 * H5 引擎（app.js）沿用巫师三昆特牌逻辑，部分天气/特殊牌效果按英文规范名结算，
 * 因此这里为中文卡牌补一个 `engineName`（英文规范名）字段供引擎识别，
 * 显示层仍使用中文 name / baseName。
 *
 * 小程序数据有改动时，重跑本脚本即可同步：
 *   node tools/build-cards.js
 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../po-ke-card-wechat-game/shared/data/zhangyu_cards.js");
const OUT = path.resolve(__dirname, "../docs/gwent_cards.json");

const DATA = require(SRC);

// 中文天气/特殊牌 -> H5 引擎识别的英文规范名
const ENGINE_NAME = {
  // 天气（时局）
  "边患四起": "Biting Frost",        // 疆场(近战)
  "党争迷局": "Impenetrable Fog",    // 朝堂(远程)
  "典籍散佚": "Torrential Rain",     // 文脉(攻城)
  "时代洪流": "Skellige Storm",      // 朝堂+文脉
  "拨云见日": "Clear Weather",       // 清除时局
  // 特殊（谋略）
  "战鼓齐鸣": "Commander's Horn",
  "釜底抽薪": "Scorch",
  "破釜沉舟": "Mardroeme",
  "请辞归隐": "Decoy"
};

function mapCard(card) {
  const out = Object.assign({}, card);
  // H5 卡牌浏览区按 expansion 过滤，统一标为本体，避免 undefined
  out.expansion = card.expansion || "Base game";
  const engineName = ENGINE_NAME[card.baseName];
  if (engineName) out.engineName = engineName;
  return out;
}

const cards = (DATA.cards || []).map(mapCard);
const tokens = (DATA.tokens || []).map(mapCard);

const byFaction = {};
const baseNames = new Set();
cards.forEach(c => {
  byFaction[c.faction] = (byFaction[c.faction] || 0) + 1;
  baseNames.add(c.baseName);
});

const byCategory = {};
cards.forEach(c => { byCategory[c.category] = (byCategory[c.category] || 0) + 1; });

const result = {
  title: "来盘章鱼牌吧 · 卡牌数据",
  version: DATA.version || "zhangyu-core",
  generatedAt: new Date().toISOString(),
  note: "卡牌、能力、阵营、领袖与微信小游戏《来盘章鱼牌吧》保持一致；由 tools/build-cards.js 从小程序数据生成。图片走 assets/card-icons 软链，运行时读取本地卡图。",
  factions: DATA.factions || {},
  rows: DATA.rows || {},
  summary: {
    totalCardCopies: cards.length,
    uniqueBaseCards: baseNames.size,
    byFaction,
    byExpansion: { "Base game": cards.length, "Hearts of Stone": 0, "Blood and Wine": 0 },
    byCategory,
    missingAttributeNames: []
  },
  cards,
  tokens
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
console.log(`[build-cards] wrote ${cards.length} cards, ${tokens.length} tokens -> ${path.relative(process.cwd(), OUT)}`);
