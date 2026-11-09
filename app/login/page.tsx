'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setMessage('Add your Supabase values to .env.local to enable account sign-in.');
      return;
    }

    setBusy(true);
    setMessage('');
    const supabase = createClient();
    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });

    if (result.error) {
      setMessage(result.error.message);
      setBusy(false);
      return;
    }

    if (mode === 'signup' && !result.data.session) {
      setMessage('Account created. Check your email if confirmation is enabled, then sign in.');
      setBusy(false);
      return;
    }

    router.push('/');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-5 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#123f4a] text-white">♥</span><span className="text-lg font-bold tracking-tight text-[#123f4a]">SickleCare</span></Link>
        <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_20px_70px_rgba(15,23,42,0.08)] sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#176254]">Patient account</p>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">{mode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Sign in to keep your symptom journal and wearable history together.</p>
          {!isSupabaseConfigured && <div className="mt-6 rounded-2xl bg-[#fff8ee] p-4 text-sm leading-6 text-[#8b612c]">Preview mode is ready on the dashboard. Connect Supabase in <code className="rounded bg-white px-1.5 py-0.5 text-xs">.env.local</code> when you want persistent accounts and data.</div>}
          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <label className="block text-sm font-semibold text-slate-700">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-normal text-slate-900 outline-none focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]" placeholder="you@example.com" /></label>
            <label className="block text-sm font-semibold text-slate-700">Password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-normal text-slate-900 outline-none focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]" placeholder="At least 6 characters" /></label>
            <button disabled={busy} type="submit" className="flex h-12 w-full items-center justify-center rounded-xl bg-[#123f4a] text-sm font-bold text-white transition hover:bg-[#0b3038] disabled:cursor-wait disabled:opacity-60">{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          </form>
          <p aria-live="polite" className="mt-4 min-h-5 text-center text-sm text-[#176254]">{message}</p>
          <div className="mt-5 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">{mode === 'signin' ? 'New to SickleCare?' : 'Already have an account?'} <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }} className="font-bold text-[#176254] hover:underline">{mode === 'signin' ? 'Create an account' : 'Sign in'}</button></div>
        </section>
        <p className="mt-6 text-center text-xs leading-5 text-slate-400">SickleCare is an informational prototype and does not provide medical diagnosis or emergency monitoring.</p>
      </div>
    </main>
  );
}
