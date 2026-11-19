// Loaded only into the console-owned ACP process by an extra patch layer.
// Reapply the UI's permission choice to restored sessions before any turn starts.
export const name = 'santi-permission-guard';
export function apply(ctx, config) {
  ctx.on('agent/created', ({ agent }) => {
    agent.session.append('sandbox/mode', { mode: config.mode === 'read' ? 'read-only' : 'workspace-write' });
    agent.session.append('approval/policy', { policy: 'ask' });
  });
}
