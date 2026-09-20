#!/usr/bin/env node
/**
 * CI 辅助脚本：从 xcworkspace 里挑出「App 自己的」scheme。
 *
 * 背景：CocoaPods 生成的 workspace 里混着大量第三方 scheme（boost / RCT-Folly /
 * Pods-* 等）。随便取 schemes[0] 会归档到某个 Pod，xcodebuild 照样报
 * ARCHIVE SUCCEEDED，但产物里根本没有 .app。
 *
 * 做法：
 *   1. 取 workspace 的全部 scheme
 *   2. 减去 Pods.xcodeproj 里声明的 scheme（剩下的才是主工程的）
 *   3. 再按 app.json 的 expo.name 做归一化匹配，命中则优先返回
 *
 * 用法: node tools/pick-ios-scheme.js <workspace或project路径> [appName]
 * 输出: 选中的 scheme（stdout，单行）；找不到时退出码 1
 */
const { execFileSync } = require('child_process');

const target = process.argv[2];
const appName = process.argv[3] || '';

/** 归一化：只留字母数字并转小写，用于忽略 - / 空格 / 大小写差异 */
const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

function listSchemes(path, kind) {
  try {
    const out = execFileSync('xcodebuild', [kind === 'workspace' ? '-workspace' : '-project', path, '-list', '-json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const json = JSON.parse(out);
    const node = kind === 'workspace' ? json.workspace : json.project;
    return Array.isArray(node && node.schemes) ? node.schemes : [];
  } catch (e) {
    return [];
  }
}

if (!target) {
  console.error('usage: pick-ios-scheme.js <workspace|project> [appName]');
  process.exit(1);
}

/** 与 workspace 同名的主工程（ios/App.xcodeproj），它的 scheme 才是 App 的 */
const dir = require('path').dirname(target);
const base = require('path').basename(target).replace(/\.xcworkspace$/, '');
const mainProjectSchemes = listSchemes(`${dir}/${base}.xcodeproj`, 'project');

const isWorkspace = /\.xcworkspace$/.test(target);
const schemes = listSchemes(target, isWorkspace ? 'workspace' : 'project');
if (!schemes.length) {
  console.error(`pick-ios-scheme: 没能从 ${target} 读到 scheme 列表`);
  process.exit(1);
}

// Pods 项目里的 scheme 全部排除（boost / Folly / Pods-App 等）
const podsProject = target.replace(/[^/]+$/, 'Pods/Pods.xcodeproj');
const podsSchemes = new Set(listSchemes(podsProject, 'project'));

const candidates = schemes.filter((s) => {
  if (/^Pods-/i.test(s)) return false;
  if (podsSchemes.has(s)) return false;
  return true;
});

const pool = candidates.length ? candidates : schemes;

const matchName = (list) => {
  if (!appName) return '';
  const key = normalize(appName);
  return list.find((s) => normalize(s) === key) || '';
};

// 优先级：主工程里按 expo.name 命中 → 主工程第一个 → 过滤后列表命中 → 过滤后第一个
const picked =
  matchName(mainProjectSchemes) ||
  mainProjectSchemes[0] ||
  matchName(pool) ||
  pool[0] ||
  '';

console.log(picked);
