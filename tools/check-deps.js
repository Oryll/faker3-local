#!/usr/bin/env node
/**
 * check-deps.js —— 静态检查 scripts.json 里每个脚本的外部依赖是否都已安装。
 *
 * 用法:  node tools/check-deps.js [--all]
 *        默认只检查组内脚本；--all 检查仓库里所有 jd_*.js。
 *
 * 只做顶层 require 解析（加载即失败的那类问题），不追运行时懒加载。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const BUILTINS = new Set(Module.builtinModules);
const RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

// 混淆代码（Function() 字符串载荷）里夹带的假包名，项目里并不存在，也不影响运行：
// 实测 node jd_ttgd.js 正常跑通（exit 0），所以静态扫描时忽略掉。
const IGNORED = new Set(['@redacted/enterprise-plugin', '@redacted/components']);

function depsOf(file) {
    const src = fs.readFileSync(file, 'utf8');
    const out = new Set();
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src)) !== null) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!IGNORED.has(pkg)) out.add(pkg);
    }
    return [...out];
}

function missingOf(file) {
    const missing = [];
    for (const pkg of depsOf(file)) {
        if (BUILTINS.has(pkg)) continue;
        try {
            require.resolve(pkg, { paths: [ROOT] });
        } catch {
            missing.push(pkg);
        }
    }
    return missing;
}

function main() {
    const checkAll = process.argv.includes('--all');
    let files = [];

    if (checkAll) {
        files = fs.readdirSync(ROOT).filter((f) => /^jd_.*\.js$/.test(f))
            .map((f) => path.join(ROOT, f));
    } else {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts.json'), 'utf8'));
        const seen = new Set();
        for (const list of Object.values(cfg.groups || {})) {
            for (const s of list) {
                if (s.startsWith('#')) continue; // 注释行
                const abs = path.join(ROOT, s);
                if (fs.existsSync(abs) && !seen.has(abs)) {
                    seen.add(abs);
                    files.push(abs);
                }
            }
        }
    }

    let bad = 0;
    for (const f of files) {
        const missing = missingOf(f);
        if (missing.length) {
            bad++;
            console.log(`✗ ${path.basename(f)}  缺: ${missing.join(', ')}`);
        }
    }

    console.log('');
    console.log(`检查 ${files.length} 个脚本，${bad} 个有缺失依赖。`);
    if (!bad) console.log('全部依赖已安装 ✓');
    process.exit(bad ? 1 : 0);
}

main();
