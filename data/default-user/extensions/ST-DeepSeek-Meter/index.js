// DeepSeek 用量与峰谷面板 + 输出自动贴底 + 思考块隔离
(function () {
    'use strict';

    // ---------------- 价格 ----------------
    const PRICES = {
        'deepseek-flash': {
            off: { hit: 0.02, miss: 1.0, out: 4.0 },
            peak: { hit: 0.04, miss: 2.0, out: 8.0 },
        },
        'deepseek-v4-pro': {
            off: { hit: 0.15, miss: 4.5, out: 13.5 },
            peak: { hit: 0.30, miss: 9.0, out: 27.0 },
        },
    };
    const CACHE_HIT_RATE = 0.8;
    const BALANCE_TTL = 60000;

    let balance = null;
    let balanceErr = '';
    let balanceTs = 0;
    let balanceLoading = false;

    function bj() { return new Date(Date.now() + 8 * 3600 * 1000); }

    function fmtDuration(ms) {
        if (ms < 0) ms = 0;
        const totalMin = Math.floor(ms / 60000);
        const d = Math.floor(totalMin / 1440);
        const h = Math.floor((totalMin % 1440) / 60);
        const m = totalMin % 60;
        if (d > 0) return d + '天' + h + '小时';
        if (h > 0) return h + 'h' + m + 'm';
        return m + 'm';
    }

    function phase() {
        const d = bj();
        const dow = d.getUTCDay();
        const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
        if (dow === 0 || dow === 6) {
            const daysToMon = dow === 6 ? 2 : 1;
            return { peak: false, nextMs: (daysToMon * 1440 - mins + 540) * 60000, nextLabel: '高峰' };
        }
        const inPeak = (mins >= 540 && mins < 720) || (mins >= 840 && mins < 1080);
        if (inPeak) {
            const end = mins < 720 ? 720 : 1080;
            return { peak: true, nextMs: (end - mins) * 60000, nextLabel: '谷时' };
        }
        if (mins < 540) return { peak: false, nextMs: (540 - mins) * 60000, nextLabel: '高峰' };
        if (mins < 840) return { peak: false, nextMs: (840 - mins) * 60000, nextLabel: '高峰' };
        let addDays = 1;
        let nd = (dow + 1) % 7;
        while (nd === 0 || nd === 6) { addDays++; nd = (nd + 1) % 7; }
        return { peak: false, nextMs: (addDays * 1440 - mins + 540) * 60000, nextLabel: '高峰' };
    }

    function ctxSafe() {
        try { return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null; }
        catch (e) { return null; }
    }

    function modelKey() {
        const c = ctxSafe();
        const m = c && c.chatCompletionSettings && c.chatCompletionSettings.deepseek_model;
        if (m && PRICES[m]) return m;
        if (m && String(m).indexOf('pro') >= 0) return 'deepseek-v4-pro';
        return 'deepseek-flash';
    }

    function tokOf(msg) {
        if (msg.token_count > 0) return msg.token_count;
        return Math.ceil(((msg.mes || '').length) * 0.6);
    }

    function usage() {
        const c = ctxSafe();
        const chat = (c && c.chat) || [];
        let acc = 0, inTok = 0, outTok = 0, replies = 0;
        for (const msg of chat) {
            const t = tokOf(msg) + 4;
            if (!msg.is_user && !msg.is_system) { outTok += tokOf(msg); replies++; }
            acc += t;
            inTok += acc;
        }
        return { inTok, outTok, replies };
    }

    function costOf(inTok, outTok, p) {
        const hit = inTok * CACHE_HIT_RATE;
        const miss = inTok * (1 - CACHE_HIT_RATE);
        return (hit * p.hit + miss * p.miss + outTok * p.out) / 1e6;
    }

    function fmtTok(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    }

    // ---------------- 余额 ----------------
    async function refreshBalance(force) {
        if (balanceLoading) return;
        if (!force && Date.now() - balanceTs < BALANCE_TTL) return;
        balanceLoading = true;
        try {
            const r = await fetch('/api/plugins/deepseek-balance/balance', { cache: 'no-store' });
            const j = await r.json();
            if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
            const infos = j.balance_infos || [];
            const cny = infos.find(x => x.currency === 'CNY') || infos[0];
            balance = cny ? { total: cny.total_balance, granted: cny.granted_balance, topped: cny.topped_up_balance } : null;
            balanceErr = '';
            balanceTs = Date.now();
        } catch (e) {
            balanceErr = e && e.message ? e.message : String(e);
            balanceTs = Date.now();
        } finally {
            balanceLoading = false;
            render();
        }
    }

    // ---------------- 面板 ----------------
    let el = null;

    function ensureDom() {
        if (el && document.body.contains(el)) return true;
        const host = document.getElementById('send_form');
        if (!host || !host.parentNode) return false;
        el = document.createElement('div');
        el.id = 'dsm-panel';
        el.title = '点击展开明细；点余额立即刷新';
        el.innerHTML = '<span class="dsm-tag off">谷时</span>'
            + '<span class="dsm-timer"></span>'
            + '<span class="dsm-sep">|</span>'
            + '<span class="dsm-bal"></span>'
            + '<span class="dsm-sep">|</span>'
            + '<span>本会话</span>'
            + '<span class="dsm-cost"></span>'
            + '<span class="dsm-sep">·</span>'
            + '<span class="dsm-tok"></span>'
            + '<div class="dsm-detail"></div>';
        host.parentNode.insertBefore(el, host);
        el.addEventListener('click', function (evt) {
            if (evt.target && evt.target.classList && evt.target.classList.contains('dsm-bal')) {
                refreshBalance(true);
            }
            el.classList.toggle('dsm-open');
        });
        return true;
    }

    function render() {
        if (!ensureDom()) return;
        const ph = phase();
        const mk = modelKey();
        const u = usage();
        const p = PRICES[mk][ph.peak ? 'peak' : 'off'];
        const cost = costOf(u.inTok, u.outTok, p);

        const tag = el.querySelector('.dsm-tag');
        tag.textContent = ph.peak ? '高峰' : '谷时';
        tag.className = 'dsm-tag ' + (ph.peak ? 'peak' : 'off');
        el.querySelector('.dsm-timer').textContent = '距' + ph.nextLabel + ' ' + fmtDuration(ph.nextMs);

        const balEl = el.querySelector('.dsm-bal');
        if (balance) {
            balEl.textContent = '余额 ¥' + balance.total;
            balEl.style.color = parseFloat(balance.total) < 5 ? '#ff9a9a' : '#7fd9b0';
        } else if (balanceErr) {
            balEl.textContent = '余额读取失败';
            balEl.title = balanceErr;
            balEl.style.color = '#8899b4';
        } else {
            balEl.textContent = '余额 …';
            balEl.style.color = '#8899b4';
        }

        el.querySelector('.dsm-cost').textContent = ' ≈¥' + (cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3));
        el.querySelector('.dsm-tok').textContent = '入 ' + fmtTok(u.inTok) + ' · 出 ' + fmtTok(u.outTok);

        const balLine = balance
            ? '账户余额 ¥' + balance.total + '（充值 ' + balance.topped + ' / 赠送 ' + balance.granted + '）'
            : (balanceErr ? '余额读取失败：' + balanceErr : '余额读取中…');

        el.querySelector('.dsm-detail').textContent =
            balLine + '\n'
            + '模型 ' + mk + '（当前单价 元/百万：命中 ' + p.hit + '，未命中 ' + p.miss + '，输出 ' + p.out + '）\n'
            + '回复 ' + u.replies + ' 楼 | 缓存命中率按 ' + Math.round(CACHE_HIT_RATE * 100) + '% 估算\n'
            + '估算输入 ' + u.inTok.toLocaleString() + ' tokens，输出 ' + u.outTok.toLocaleString() + ' tokens\n'
            + '※ 会话费用为前端估算，余额为实时查询，均以 DeepSeek 账单为准';
    }

    // ---------------- 自动贴底 ----------------
    let stick = true;
    let generating = false;

    function chatEl() { return document.getElementById('chat'); }

    function distanceFromBottom() {
        const c = chatEl();
        if (!c) return 0;
        return c.scrollHeight - c.scrollTop - c.clientHeight;
    }

    function toBottom(force) {
        const c = chatEl();
        if (!c) return;
        if (!force && !stick) return;
        c.scrollTop = c.scrollHeight;
    }

    function initAutoScroll() {
        const c = chatEl();
        if (!c) return;

        // 用户手动上翻时暂停跟随，回到接近底部自动恢复
        c.addEventListener('scroll', function () {
            stick = distanceFromBottom() < 140;
        }, { passive: true });

        // 流式输出时 DOM 会不断变化，借此实时贴底
        const obs = new MutationObserver(function () {
            if (generating) toBottom(false);
        });
        obs.observe(c, { childList: true, subtree: true, characterData: true });
    }

    function hookEvents() {
        try {
            const ctx = ctxSafe();
            if (!ctx) return;
            const et = ctx.event_types || {};
            const on = function (name, fn) { if (et[name]) ctx.eventSource.on(et[name], fn); };

            on('GENERATION_STARTED', function () { generating = true; stick = true; toBottom(true); });
            on('GENERATION_AFTER_COMMANDS', function () { generating = true; stick = true; toBottom(true); });
            on('GENERATION_ENDED', function () { generating = false; toBottom(true); });
            on('GENERATION_STOPPED', function () { generating = false; });

            [et.MESSAGE_RECEIVED, et.MESSAGE_SENT, et.CHARACTER_MESSAGE_RENDERED,
             et.MESSAGE_DELETED, et.MESSAGE_EDITED, et.CHAT_CHANGED]
                .filter(Boolean)
                .forEach(function (ev) {
                    ctx.eventSource.on(ev, function () {
                        setTimeout(function () { toBottom(true); render(); }, 120);
                        setTimeout(function () { refreshBalance(false); }, 2000);
                    });
                });
        } catch (e) { console.warn('[DSMeter] 事件监听失败', e); }
    }

    // ---------------- 启动 ----------------
    function boot() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            setTimeout(boot, 1000);
            return;
        }
        render();
        refreshBalance(true);
        initAutoScroll();
        hookEvents();
        setInterval(render, 30000);
        setInterval(function () { refreshBalance(false); }, BALANCE_TTL);
        // 兜底轮询：生成期间强制贴底
        setInterval(function () { if (generating) toBottom(false); }, 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
