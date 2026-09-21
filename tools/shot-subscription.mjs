/**
 * 生成订阅（自动续期）审核截图。
 *
 * 前置：先起 Web 服务
 *   EXPO_PUBLIC_SHOW_DIAGNOSTIC=false npx expo start --web --port 8081
 * 出图：
 *   node tools/shot-subscription.mjs
 *
 * 说明：
 *  - 金额不写死在业务代码里，这里通过 window.__CIBA_SHOT_IAP__ 注入
 *    （见 src/services/iapService.web.ts），页面仍按真实版式渲染。
 *  - 出图尺寸 428×926 CSS × DPR 3 = 1284×2778（iPhone 6.7"，符合商店审核尺寸）。
 *  - 用本机已装的 Chrome（playwright-core 不自带浏览器，无需下载 Chromium）。
 */

import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = process.env.SHOT_URL || 'http://localhost:8081';
const OUT_DIR = path.resolve('AppStoreShots');

const USER = {
  id: 1001,
  nickname: '糍粑学员',
  mobile: '13800001234',
  loginName: 'demo',
};

const YEARLY = 'com.yugusoft.CibaEnglish.category.yearly';
const MONTHLY = 'com.yugusoft.CibaEnglish.category.monthly';

/** 注入的 StoreKit 价格：包月 ¥15、包年 ¥90（折合省 50%） */
const IAP = {
  [YEARLY]: { title: '连续包年 VIP', localizedPrice: '¥90', currency: 'CNY', price: 90 },
  [MONTHLY]: { title: '连续包月 VIP', localizedPrice: '¥15', currency: 'CNY', price: 15 },
};

const PRICE_TAGS = [
  { id: 102, name: '连续包年 VIP', type: 0, num: 1, appleProductId: YEARLY },
  { id: 101, name: '连续包月 VIP', type: 2, num: 1, appleProductId: MONTHLY },
];

/**
 * 我的词库里放一个词库，避免「我的词库为空」时 App 直接跳到词库市场
 * 挡住底部 tab（会让「我的」点不到）。
 */
const MY_PACKS = [
  {
    id: 9001,
    name: '英语分类词汇',
    pack_type: 'qian_wen_cat',
    card_count: 1200,
    parent_id: 0,
    today_card_count: 20,
  },
];

const SHOTS = [
  { plan: '1 年', price: '¥90', file: '订阅审核-包年选中.png' },
  { plan: '1 个月', price: '¥15', file: '订阅审核-包月选中.png' },
];

function mockApi(route) {
  const url = new URL(route.request().url());
  const p = url.pathname;
  let body = { result: 0 };

  if (p.includes('/users/my')) body = { result: 0, user: USER };
  else if (p.includes('/users/check/status')) body = { result: 0, status: 0 };
  else if (p.includes('/pay/price_tags')) body = { result: 0, list: PRICE_TAGS };
  else if (p.includes('/anki/pack/in-store')) body = { result: 0, packs: [], total: 0 };
  else if (p.includes('/anki/pack'))
    body = { result: 0, packs: MY_PACKS, total: MY_PACKS.length };

  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`找不到 Chrome: ${CHROME}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    deviceScaleFactor: 3,
    locale: 'zh-CN',
  });

  await context.addInitScript(
    ([user, iap]) => {
      localStorage.setItem('@ciba_auth_token', 'shot-token');
      localStorage.setItem('@ciba_token', 'shot-token');
      localStorage.setItem('@ciba_user_info', JSON.stringify(user));
      window.__CIBA_SHOT_IAP__ = iap;
    },
    [USER, IAP]
  );
  await context.route('**://cibaen.com/api/**', mockApi);

  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn('[pageerror]', e.message));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('我的', { exact: true }).click({ timeout: 120000 });
  await page.getByText('升级会员', { exact: true }).click({ timeout: 60000 });
  await page.getByText('解锁全部权益').waitFor({ timeout: 60000 });
  await page.getByText('省 50%').waitFor({ timeout: 30000 });

  for (const shot of SHOTS) {
    await page.getByText(shot.plan, { exact: true }).click();
    await page.getByText(shot.price, { exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const file = path.join(OUT_DIR, shot.file);
    await page.screenshot({ path: file });
    const { width, height } = JSON.parse(
      JSON.stringify(await page.evaluate(() => ({ width: 428, height: 926 })))
    );
    console.log('ok', shot.file, `${width * 3}×${height * 3}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
