import { useEffect, useRef } from 'react';
const DEFAULT_TAP_GRACE_MS = 140;
const DEFAULT_TAP_SLOP_PX = 6;
export function useTouchGestures(targetRef, options) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const pointersRef = useRef(new Map());
    const gestureRef = useRef(null);
    const activeRef = useRef(false);
    const pendingRef = useRef(null);
    const api = useRef({
        isGesturing: () => activeRef.current,
        touchPointerCount: () => pointersRef.current.size,
        deferTouchStart: () => undefined,
        flushTouchStart: () => undefined,
        cancelTouchStart: () => undefined,
    });
    useEffect(() => {
        const element = targetRef.current;
        if (!element)
            return undefined;
        const clearTimer = () => {
            const pending = pendingRef.current;
            if (pending?.timer) {
                clearTimeout(pending.timer);
                pending.timer = null;
            }
        };
        const cancelPending = () => {
            clearTimer();
            pendingRef.current = null;
        };
        const flushPending = () => {
            const pending = pendingRef.current;
            if (!pending)
                return;
            clearTimer();
            pendingRef.current = null;
            pending.run();
        };
        api.current.deferTouchStart = (pointerId, run) => {
            cancelPending();
            const grace = optionsRef.current.tapGraceMs ?? DEFAULT_TAP_GRACE_MS;
            const source = pointersRef.current.get(pointerId);
            const pending = { pointerId, run, x: source?.x ?? 0, y: source?.y ?? 0, timer: null };
            if (grace > 0) {
                pending.timer = setTimeout(() => {
                    if (pendingRef.current === pending)
                        flushPending();
                }, grace);
            }
            pendingRef.current = pending;
            if (grace <= 0)
                flushPending();
        };
        api.current.flushTouchStart = () => flushPending();
        api.current.cancelTouchStart = () => cancelPending();
        const localPoint = (event) => {
            const rect = element.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };
        const beginGesture = () => {
            const [a, b] = [...pointersRef.current.values()];
            if (!a || !b)
                return;
            const t0 = optionsRef.current.getTransform();
            const d0 = Math.hypot(b.x - a.x, b.y - a.y);
            const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            if (!(d0 > 0))
                return;
            // 出现第二根手指 ⇒ 这一次落笔作废（不留脏点、不写撤销历史）
            cancelPending();
            gestureRef.current = { d0, m0, t0 };
            activeRef.current = true;
            optionsRef.current.onGestureStart?.({ pointerCount: pointersRef.current.size, centerX: m0.x, centerY: m0.y, distance: d0 });
        };
        const endGestureIfDone = () => {
            if (!activeRef.current)
                return;
            if (pointersRef.current.size >= 2) {
                // 仍有两指 ⇒ 换指后重新取快照，避免跳变
                beginGesture();
                return;
            }
            activeRef.current = false;
            gestureRef.current = null;
            optionsRef.current.onGestureEnd?.();
        };
        const onPointerDown = (event) => {
            if (event.pointerType !== 'touch')
                return;
            pointersRef.current.set(event.pointerId, localPoint(event));
            if (pointersRef.current.size >= 2) {
                // 第一根手指刚落下、落笔还挂在 pending 里时，这里必须能把它取消掉
                if (event.cancelable)
                    event.preventDefault();
                beginGesture();
                return;
            }
            if (event.cancelable)
                event.preventDefault();
            try {
                element.setPointerCapture(event.pointerId);
            }
            catch {
                /* 某些浏览器对未激活指针会抛，忽略 */
            }
        };
        const onPointerMove = (event) => {
            if (event.pointerType !== 'touch')
                return;
            if (!pointersRef.current.has(event.pointerId))
                return;
            const point = localPoint(event);
            pointersRef.current.set(event.pointerId, point);
            if (activeRef.current) {
                if (event.cancelable)
                    event.preventDefault();
                const gesture = gestureRef.current;
                const [a, b] = [...pointersRef.current.values()];
                if (!gesture || !a || !b)
                    return;
                const distance = Math.hypot(b.x - a.x, b.y - a.y);
                if (!(distance > 0))
                    return;
                const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const minZoom = optionsRef.current.minZoom ?? 0.12;
                const maxZoom = optionsRef.current.maxZoom ?? 5;
                const scale = distance / gesture.d0;
                const nextZoom = Math.min(maxZoom, Math.max(minZoom, gesture.t0.zoom * scale));
                const effective = nextZoom / gesture.t0.zoom;
                // 保持「手势起点中点下的世界坐标」不动：pan' = m' - (z'/z0) * (m0 - pan0)
                // （纯平移时 effective === 1 ⇒ pan' = pan0 + (m' - m0)，即按中点位移平移）
                optionsRef.current.onTransform({
                    zoom: nextZoom,
                    panX: center.x - effective * (gesture.m0.x - gesture.t0.panX),
                    panY: center.y - effective * (gesture.m0.y - gesture.t0.panY),
                });
                return;
            }
            const pending = pendingRef.current;
            if (pending && pending.pointerId === event.pointerId) {
                const slop = optionsRef.current.tapSlopPx ?? DEFAULT_TAP_SLOP_PX;
                if (Math.hypot(point.x - pending.x, point.y - pending.y) > slop) {
                    if (event.cancelable)
                        event.preventDefault();
                    flushPending();
                }
            }
        };
        const onPointerUp = (event) => {
            if (event.pointerType !== 'touch')
                return;
            const pending = pendingRef.current;
            if (pending && pending.pointerId === event.pointerId) {
                // 快速点一下也要真落笔
                flushPending();
            }
            pointersRef.current.delete(event.pointerId);
            if (activeRef.current) {
                endGestureIfDone();
                return;
            }
        };
        const onPointerCancel = (event) => {
            if (event.pointerType !== 'touch')
                return;
            const pending = pendingRef.current;
            if (pending && pending.pointerId === event.pointerId)
                cancelPending();
            pointersRef.current.delete(event.pointerId);
            if (activeRef.current)
                endGestureIfDone();
        };
        element.addEventListener('pointerdown', onPointerDown, true);
        element.addEventListener('pointermove', onPointerMove, true);
        element.addEventListener('pointerup', onPointerUp, true);
        element.addEventListener('pointercancel', onPointerCancel, true);
        return () => {
            element.removeEventListener('pointerdown', onPointerDown, true);
            element.removeEventListener('pointermove', onPointerMove, true);
            element.removeEventListener('pointerup', onPointerUp, true);
            element.removeEventListener('pointercancel', onPointerCancel, true);
            cancelPending();
            pointersRef.current.clear();
            activeRef.current = false;
            gestureRef.current = null;
            api.current.deferTouchStart = () => undefined;
            api.current.flushTouchStart = () => undefined;
            api.current.cancelTouchStart = () => undefined;
        };
    }, [targetRef]);
    return api.current;
}
/**
 * 触屏上的提示出口（`title` 与 `data-tooltip` 两种都管）。
 *
 * 为什么需要：
 * - `title` 在触屏上完全不显示（iOS Safari / Android Chrome 都没有 hover 提示），
 *   而项目里 20+ 处 `title` 承载着「色号 + 色名」这类触屏本来拿不到的信息。**不删 title**，
 *   另加一条「点一下就显示」的轻量提示。
 * - `.help-dot`（`?` 帮助点）用的是 `data-tooltip` + CSS `:hover/:focus-visible`。W1 实测它在
 *   触摸仿真下可用，但 **iOS Safari 是否给 `<span tabindex=0>` 聚焦没有验证** ⇒ W2 这里一并兜住：
 *   点一下就直接弹同一套提示，不再依赖浏览器给不给焦点。
 *
 * 只对 `pointerType === 'touch'` 生效 ⇒ 桌面（鼠标）永远不触发，桌面像素不变。
 *
 * 两个避免"弹废话 / 弹两次"的守卫：
 * 1. 可见文字已经包含 title 的元素（例如按钮文案本身就是 title）不弹；
 * 2. 延迟 130ms 再建提示，若此时 App 自己的 `.floating-help-tooltip` 已经出现（触摸会触发
 *    浏览器的 mouseenter 兼容事件，`imageHelpProps` 的 `showFloatingHelp` 会渲染它），就不再重复弹。
 */
export function installTouchTitleTips() {
    let tip = null;
    let hideTimer = null;
    let buildTimer = null;
    const hide = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        if (buildTimer) {
            clearTimeout(buildTimer);
            buildTimer = null;
        }
        if (tip) {
            tip.remove();
            tip = null;
        }
    };
    const build = (host, text) => {
        if (document.querySelector('.floating-help-tooltip'))
            return; // App 自己的出口已经弹了
        if (!host.isConnected)
            return;
        tip = document.createElement('div');
        tip.className = 'touch-title-tip';
        tip.setAttribute('role', 'tooltip');
        tip.textContent = text;
        document.body.appendChild(tip);
        const rect = host.getBoundingClientRect();
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        let top = rect.bottom + 8;
        if (top + height > window.innerHeight - 8)
            top = Math.max(8, rect.top - height - 8);
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
        hideTimer = setTimeout(hide, 2600);
    };
    const onPointerUp = (event) => {
        if (event.pointerType !== 'touch')
            return;
        hide();
        const target = event.target;
        const host = target && typeof target.closest === 'function'
            ? target.closest('[title], [data-tooltip]')
            : null;
        if (!host)
            return;
        const text = (host.getAttribute('title') || host.getAttribute('data-tooltip') || '').trim();
        if (!text)
            return;
        const visible = (host.textContent || '').replace(/\s+/g, ' ').trim();
        if (visible && visible.includes(text))
            return;
        buildTimer = setTimeout(() => {
            buildTimer = null;
            build(host, text);
        }, 130);
    };
    const onReflow = () => hide();
    document.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow, true);
    return () => {
        document.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('scroll', onReflow, true);
        window.removeEventListener('resize', onReflow, true);
        hide();
    };
}
//# sourceMappingURL=useTouchGestures.js.map