import type { Knex } from 'knex';

export type AgentNotifType =
  | 'referral_registered'
  | 'registration_active'
  | 'commission_approved'
  | 'commission_paid';

/** Sisipkan notifikasi in-portal untuk agen. `exec` boleh db atau transaksi. */
export async function notifyAgent(
  exec: Knex,
  payload: { agentId: string; type: AgentNotifType; title: string; body: string; refType?: string; refId?: string | null }
) {
  await exec('agent_notifications').insert({
    agent_id: payload.agentId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    ref_type: payload.refType ?? null,
    ref_id: payload.refId ?? null
  });
}
