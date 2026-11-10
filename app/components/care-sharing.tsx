'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Share = {
  id: string;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
  expires_at: string;
};

function makeShareCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashShareCode(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

export default function CareSharing({ enabled }: { enabled: boolean }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [autoSharing, setAutoSharing] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadShares = useCallback(async () => {
    if (!enabled) return;
    const supabase = createClient();
    const [profileResult, shareResult] = await Promise.all([
      supabase.from('profiles').select('share_vitals_with_clinicians').maybeSingle(),
      supabase.from('care_shares').select('id, status, created_at, expires_at').order('created_at', { ascending: false }).limit(10),
    ]);

    if (profileResult.error || shareResult.error) {
      setMessage('Sharing settings are unavailable until the latest database migration is applied.');
      return;
    }
    setAutoSharing(Boolean(profileResult.data?.share_vitals_with_clinicians));
    setShares((shareResult.data ?? []) as Share[]);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setShares([]);
      setAutoSharing(false);
      setShareCode('');
      setMessage('');
      return;
    }
    void loadShares();
  }, [loadShares]);

  async function setAutomaticSharing(share: boolean) {
    setBusy(true);
    setMessage('');
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setMessage('Sign in to change clinician sharing.');
      setBusy(false);
      return;
    }

    const { error } = await supabase.from('profiles')
      .update({ share_vitals_with_clinicians: share })
      .eq('id', authData.user.id);
    if (error) {
      setMessage('Could not update sharing. Please try again.');
    } else {
      setAutoSharing(share);
      setMessage(share
        ? 'Automatic sharing is on. Provisioned clinicians can now see your wearable vitals.'
        : 'Automatic sharing is off. Individual clinician connections remain active until you revoke them below.');
    }
    setBusy(false);
  }

  async function createShare() {
    setBusy(true);
    setMessage('');
    setShareCode('');
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setMessage('Sign in to create a clinician share code.');
      setBusy(false);
      return;
    }

    const code = makeShareCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('care_shares').insert({
      patient_id: authData.user.id,
      token_hash: await hashShareCode(code),
      expires_at: expiresAt,
    });

    if (error) {
      setMessage('Could not create a share code. Check that the sharing migration is applied.');
    } else {
      setShareCode(code);
      setMessage('Share this one-time code directly with your clinician. It expires in 7 days.');
      await loadShares();
    }
    setBusy(false);
  }

  async function revokeShare(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from('care_shares').update({ status: 'revoked' }).eq('id', id);
    setMessage(error ? 'Could not revoke access. Please try again.' : 'Clinician access revoked.');
    if (!error) await loadShares();
    setBusy(false);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(shareCode);
    setMessage('Share code copied. Send it only to the clinician you trust.');
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_45px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf7f4] text-[#176254]" aria-hidden="true">✚</span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Share with your care team</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Choose whether provisioned SickleCare clinicians can automatically see your wearable vitals.</p>
        </div>
      </div>

      {!enabled ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">Sign in to manage clinician access. Your readings are not shared by default.</p>
      ) : (
        <>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <input type="checkbox" checked={autoSharing} disabled={busy} onChange={(event) => void setAutomaticSharing(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#176254]" />
            <span><strong className="text-slate-800">Share my vitals automatically</strong><br />When on, provisioned clinicians can see your profile name or email and wearable readings. Symptoms stay private. Turn this off any time.</span>
          </label>
          <button type="button" disabled={busy} onClick={createShare} className="mt-5 h-11 rounded-xl bg-[#123f4a] px-4 text-sm font-bold text-white transition hover:bg-[#0b3038] disabled:opacity-60">
            {busy ? 'Working…' : 'Create sharing code'}
          </button>
          {shareCode && <div className="mt-4 rounded-2xl border border-[#c9e3de] bg-[#f1faf7] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#176254]">One-time code</p>
            <code className="mt-2 block break-all text-sm font-semibold text-slate-800">{shareCode}</code>
            <button type="button" onClick={copyCode} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#176254] ring-1 ring-[#c9e3de]">Copy code</button>
          </div>}

          {shares.length > 0 && <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Sharing access</p>
            {shares.map((share) => <div key={share.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
              <div>
                <p className="text-sm font-semibold capitalize text-slate-700">{share.status === 'active' ? 'Clinician connected' : share.status === 'pending' ? 'Code awaiting redemption' : 'Access revoked'}</p>
                <p className="mt-1 text-xs text-slate-400">{share.status === 'pending' ? `Code expires ${formatExpiry(share.expires_at)}` : `Created ${formatExpiry(share.created_at)}`}</p>
              </div>
              {share.status !== 'revoked' && <button type="button" disabled={busy} onClick={() => void revokeShare(share.id)} className="shrink-0 text-xs font-bold text-rose-600 hover:text-rose-800 disabled:opacity-50">Revoke</button>}
            </div>)}
          </div>}
        </>
      )}
      <p aria-live="polite" className="mt-4 min-h-5 text-xs leading-5 text-slate-500">{message}</p>
      <p className="mt-2 text-xs leading-5 text-slate-400">Automatic sharing applies only to clinician accounts provisioned for SickleCare. You can switch it off at any time. This prototype does not provide emergency monitoring.</p>
    </section>
  );
}
