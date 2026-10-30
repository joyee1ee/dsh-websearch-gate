window.__ModuleLoader__.load({
  id: 'dsh-websearch-toggle',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owning this plugin's copy. */
    const NS = 'dsh-websearch-toggle';

    /** Host route serving the per-Session value. */
    const STATE_ROUTE = 'websearch-toggle/state';

    /** This plugin's copy, in the two built-in locales. */
    const zh = {
      label: '联网搜索',
      onHint: '本会话的 Web 搜索已开启，点击关闭',
      offHint: '本会话的 Web 搜索已关闭，模型看不到该工具，点击开启',
      failed: '切换失败',
    };
    const en = {
      label: 'Web search',
      onHint: 'Web search is on for this session; click to turn it off',
      offHint: 'Web search is off for this session; the model cannot see the tool. Click to turn it on',
      failed: 'Switch failed',
    };

    /** A globe glyph; the off state adds the strike so one icon carries both states. */
    function GlobeIcon({ off }) {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      }, [
        h('circle', { key: 'c', cx: 8, cy: 8, r: 5.9 }),
        h('path', { key: 'm', d: 'M2.4 8h11.2' }),
        h('path', { key: 'v', d: 'M8 2.1c1.9 1.7 2.8 3.7 2.8 5.9S9.9 12.2 8 13.9C6.1 12.2 5.2 10.2 5.2 8S6.1 3.8 8 2.1Z' }),
        off ? h('path', { key: 's', d: 'M3.1 12.9 12.9 3.1' }) : null,
      ]);
    }

    /** Composer trigger styling shared by both states, matching the permission control. */
    function triggerStyle(enabled, busy, hover) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: '28px',
        padding: '0 8px',
        border: 'none',
        outline: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: hover && !busy
          ? 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05))'
          : 'transparent',
        color: enabled
          ? 'var(--dsw-alias-label-secondary, #6b6b6b)'
          : 'var(--dsw-alias-label-tertiary, #a3a3a3)',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 500,
        lineHeight: '20px',
        cursor: busy ? 'progress' : 'pointer',
        opacity: busy ? 0.55 : 1,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      };
    }

    /**
     * The composer's per-Session switch. Reads the Host value on mount and whenever the
     * Session changes, then writes the next value optimistically and rolls back on failure.
     * @param props - the owning Session id and the bound copy.
     * @returns the trigger, or nothing while the Session is unknown.
     */
    function WebSearchToggle({ sessionId, t }) {
      const [enabled, setEnabled] = React.useState(true);
      const [busy, setBusy] = React.useState(false);
      const [hover, setHover] = React.useState(false);
      const [failed, setFailed] = React.useState(false);

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        let cancelled = false;
        fetch(`${STATE_ROUTE}?session=${encodeURIComponent(sessionId)}`, {
          headers: { accept: 'application/json' },
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((value) => {
            if (!cancelled && typeof value?.enabled === 'boolean') setEnabled(value.enabled);
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }, [sessionId]);

      if (typeof sessionId !== 'string' || sessionId === '') return null;

      const toggle = () => {
        if (busy) return;
        const next = !enabled;
        setBusy(true);
        setFailed(false);
        setEnabled(next);
        fetch(STATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, enabled: next }),
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((value) => {
            if (typeof value?.enabled === 'boolean') setEnabled(value.enabled);
          })
          .catch(() => {
            setEnabled(!next);
            setFailed(true);
          })
          .finally(() => {
            setBusy(false);
          });
      };

      return h('button', {
        type: 'button',
        onClick: toggle,
        disabled: busy,
        title: failed ? t('failed') : enabled ? t('onHint') : t('offHint'),
        'aria-label': enabled ? t('onHint') : t('offHint'),
        'aria-pressed': enabled,
        style: triggerStyle(enabled, busy, hover),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        children: [
          h(GlobeIcon, { key: 'icon', off: !enabled }),
          h('span', { key: 'label', children: failed ? t('failed') : t('label') }),
        ],
      });
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries and the one composer trigger.
       * @param ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'websearch-toggle: dictionaries');
        ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'websearch-toggle',
          order: 10,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, WebSearchToggle)), 'websearch-toggle: composer trigger');
      },
    };
  },
});
