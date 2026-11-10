'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function RedeemShareForm() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const supabase = createClient();
    const { error } = await supabase.rpc('redeem_care_share', { share_code: code.trim() });
    if (error) {
      setMessage(error.message.includes('not enabled for clinician access')
        ? 'This account is not enabled for clinician access yet. Ask your SickleCare administrator.'
        : 'That code could not be redeemed. Check it with the patient and try again.');
    } else {
      setCode('');
      setMessage('Patient connected. Their readings are now available below.');
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.04)] sm:p-6">
      <label className="block text-sm font-semibold text-slate-700" htmlFor="share-code">Connect a patient
        <input id="share-code" required minLength={32} maxLength={128} value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-mono text-sm font-normal text-slate-900 outline-none focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]" placeholder="Paste the one-time code" />
      </label>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-xs leading-5 text-slate-500">{message || 'The patient must create and share this code with you.'}</p>
        <button disabled={busy} type="submit" className="h-11 shrink-0 rounded-xl bg-[#123f4a] px-4 text-sm font-bold text-white transition hover:bg-[#0b3038] disabled:opacity-60">{busy ? 'Connecting…' : 'Connect patient'}</button>
      </div>
    </form>
  );
}
