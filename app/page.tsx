'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Reading = {
  id: string;
  recordedAt: string;
  timeLabel: string;
  hr: number;
  spo2: number;
  temp: number;
  signalOk: boolean;
  isSimulated: boolean;
};

type Symptom = {
  id: string;
  symptom: string;
  severity: number;
  notes: string;
  recordedAt: string;
};

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const demoReadings: Reading[] = [
  { id: 'demo-1', recordedAt: '2026-11-09T08:42:00Z', timeLabel: '08:42', hr: 72, spo2: 97, temp: 33.4, signalOk: true, isSimulated: true },
  { id: 'demo-2', recordedAt: '2026-11-09T08:27:00Z', timeLabel: '08:27', hr: 75, spo2: 96, temp: 33.3, signalOk: true, isSimulated: true },
  { id: 'demo-3', recordedAt: '2026-11-09T08:12:00Z', timeLabel: '08:12', hr: 70, spo2: 97, temp: 33.5, signalOk: true, isSimulated: true },
  { id: 'demo-4', recordedAt: '2026-11-09T07:57:00Z', timeLabel: '07:57', hr: 78, spo2: 95, temp: 33.2, signalOk: false, isSimulated: true },
  { id: 'demo-5', recordedAt: '2026-11-09T07:42:00Z', timeLabel: '07:42', hr: 74, spo2: 96, temp: 33.4, signalOk: true, isSimulated: true },
];

const demoSymptoms: Symptom[] = [
  { id: 'symptom-1', symptom: 'Fatigue', severity: 4, notes: 'A little tired after waking up.', recordedAt: 'Today, 08:05' },
  { id: 'symptom-2', symptom: 'Headache', severity: 2, notes: '', recordedAt: 'Yesterday, 19:20' },
];

function Icon({ name, className = 'h-5 w-5' }: { name: 'check' | 'clock' | 'device' | 'heart' | 'logout' | 'note' | 'plus' | 'shield' | 'signal' | 'sparkle' | 'thermometer' | 'user'; className?: string }) {
  const paths: Record<string, string> = {
    check: 'm5 12 4 4L19 6',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    device: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 15h4',
    heart: 'M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z',
    logout: 'M10 17l5-5-5-5m5 5H3m8-9h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7',
    note: 'M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 0v4h4M8 12h8M8 16h6',
    plus: 'M12 5v14m-7-7h14',
    shield: 'M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z',
    signal: 'M5 20h.01M9 16v4m4-8v8m4-12v12m4-16v16',
    sparkle: 'm12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Z',
    thermometer: 'M10 5a2 2 0 1 1 4 0v7.2a4 4 0 1 1-4 0V5Zm2 3v6',
    user: 'M20 21a8 8 0 0 0-16 0m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  };

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function Home() {
  const [readings, setReadings] = useState<Reading[]>(demoReadings);
  const [symptoms, setSymptoms] = useState<Symptom[]>(demoSymptoms);
  const [symptom, setSymptom] = useState('');
  const [severity, setSeverity] = useState('3');
  const [notes, setNotes] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [dataMode, setDataMode] = useState<'preview' | 'connected'>('preview');
  const [deviceName, setDeviceName] = useState('SickleBand · Demo unit');
  const [lastSeen, setLastSeen] = useState('2 minutes ago');
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = createClient();
    supabaseRef.current = supabase;
    let active = true;

    async function loadPatientData() {
      const { data: userData } = await supabase.auth.getUser();
      if (!active || !userData.user) return;

      setDataMode('connected');
      const [deviceResult, readingResult, symptomResult] = await Promise.all([
        supabase.from('devices').select('device_name, last_seen_at').order('created_at', { ascending: true }).limit(1).maybeSingle(),
        supabase.from('readings').select('id, recorded_at, hr_bpm, spo2_pct, skin_temp_c, signal_ok, is_simulated').order('recorded_at', { ascending: false }).limit(12),
        supabase.from('symptom_logs').select('id, symptom, severity, notes, recorded_at').order('recorded_at', { ascending: false }).limit(8),
      ]);

      if (!active) return;
      if (deviceResult.data) {
        setDeviceName(deviceResult.data.device_name);
        if (deviceResult.data.last_seen_at) setLastSeen(formatTime(deviceResult.data.last_seen_at));
      }
      if (readingResult.data?.length) {
        setReadings(readingResult.data.map((row: { id: string; recorded_at: string; hr_bpm: number; spo2_pct: number; skin_temp_c: number; signal_ok: boolean; is_simulated: boolean }) => ({
          id: row.id,
          recordedAt: row.recorded_at,
          timeLabel: formatTime(row.recorded_at),
          hr: row.hr_bpm,
          spo2: row.spo2_pct,
          temp: row.skin_temp_c,
          signalOk: row.signal_ok,
          isSimulated: row.is_simulated,
        })));
      }
      if (symptomResult.data?.length) {
        setSymptoms(symptomResult.data.map((row: { id: string; symptom: string; severity: number; notes: string | null; recorded_at: string }) => ({
          id: row.id,
          symptom: row.symptom,
          severity: row.severity,
          notes: row.notes ?? '',
          recordedAt: formatTime(row.recorded_at),
        })));
      }
    }

    void loadPatientData();
    return () => {
      active = false;
    };
  }, []);

  const latest = readings[0];
  const qualityReadings = useMemo(() => readings.filter((reading) => reading.signalOk), [readings]);
  const chartMaximum = Math.max(...qualityReadings.map((reading) => reading.hr), 80);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanSymptom = symptom.trim();
    if (!cleanSymptom) {
      setFormMessage('Add a symptom before saving.');
      return;
    }

    const nextSymptom: Symptom = {
      id: `local-${Date.now()}`,
      symptom: cleanSymptom,
      severity: Number(severity),
      notes: notes.trim(),
      recordedAt: 'Just now',
    };
    setSymptoms((current) => [nextSymptom, ...current]);
    setSymptom('');
    setSeverity('3');
    setNotes('');
    setFormMessage('Symptom saved to your log.');

    if (dataMode === 'connected' && supabaseRef.current) {
      const { data: userData } = await supabaseRef.current.auth.getUser();
      if (userData.user) {
        await supabaseRef.current.from('symptom_logs').insert({
          user_id: userData.user.id,
          symptom: cleanSymptom,
          severity: Number(severity),
          notes: notes.trim() || null,
        });
      }
    }
  }

  async function handleSignOut() {
    if (supabaseRef.current) await supabaseRef.current.auth.signOut();
    router.push('/');
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="SickleCare home">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#123f4a] text-white shadow-lg shadow-[#123f4a]/15"><Icon name="heart" className="h-5 w-5" /></span>
            <span><span className="block text-[15px] font-bold tracking-tight text-[#123f4a]">SickleCare</span><span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Patient companion</span></span>
          </Link>
          <div className="flex items-center gap-3">
            <span className={`hidden items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold sm:flex ${dataMode === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}><span className={`h-2 w-2 rounded-full ${dataMode === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />{dataMode === 'connected' ? 'Account connected' : 'Preview mode'}</span>
            {dataMode === 'connected' ? <button onClick={handleSignOut} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-950" type="button"><Icon name="logout" className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button> : <Link href="/login" className="flex items-center gap-2 rounded-xl bg-[#123f4a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0b3038]"><Icon name="user" className="h-4 w-4" /><span>Sign in</span></Link>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div><div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#e7f3f0] px-3 py-1.5 text-xs font-semibold text-[#176254]"><Icon name="sparkle" className="h-3.5 w-3.5" />A clearer view of today</div><h1 className="max-w-2xl text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">Good morning. Let&apos;s check in with you.</h1><p className="mt-4 max-w-2xl text-base leading-7 text-slate-500 sm:text-lg">Review your wearable readings, capture how you feel, and bring a simple record to your next care conversation.</p></div>
          <div className="flex items-center gap-3 text-sm text-slate-500"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#176254] shadow-sm ring-1 ring-slate-200"><Icon name="clock" className="h-5 w-5" /></span><span><strong className="block font-semibold text-slate-800">Monday, 9 November</strong><span className="text-xs text-slate-400">Last sync {lastSeen}</span></span></div>
        </section>

        <section className="mb-8 rounded-3xl border border-[#c9e3de] bg-[#eaf7f4] p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#176254] shadow-sm"><Icon name="shield" className="h-5 w-5" /></span><div><p className="font-semibold text-[#123f4a]">Your information, at a glance</p><p className="mt-1 max-w-3xl text-sm leading-6 text-[#3c7069]">This prototype is informational only. The wearable values below are simulated, are not clinically validated, and do not diagnose, predict crises, or replace advice from a qualified health professional.</p></div></div><span className="shrink-0 self-start rounded-full bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[#176254]">{dataMode === 'connected' ? 'Live account' : 'Simulated data'}</span></div></section>

        <section className="mb-8 grid gap-4 md:grid-cols-3"><MetricCard label="Heart rate" value={`${latest.hr}`} unit="bpm" helper="Latest wearable reading" tone="rose" icon="heart" /><MetricCard label="SpO₂ approximation" value={`${latest.spo2}`} unit="%" helper="Low-cost sensor estimate" tone="blue" icon="signal" /><MetricCard label="Peripheral skin temperature" value={`${latest.temp.toFixed(1)}`} unit="°C" helper="Informational, not core temperature" tone="amber" icon="thermometer" /></section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,0.9fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.04)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf7f4] text-[#176254]"><Icon name="heart" className="h-4 w-4" /></span><h2 className="text-lg font-bold text-slate-900">Recent readings</h2></div><p className="mt-2 text-sm text-slate-500">A quick view of the last readings received from your device.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">{readings.length} readings shown</span></div>
              <div className="mt-7 rounded-2xl bg-[#f8fafc] p-4 sm:p-5"><div className="flex items-center justify-between text-xs font-semibold text-slate-400"><span>Heart rate · bpm</span><span>Last 5 quality readings</span></div><div className="mt-5 flex h-36 items-end gap-2 sm:gap-4">{qualityReadings.slice(0, 5).reverse().map((reading, index) => <div className="flex flex-1 flex-col items-center gap-2" key={reading.id}><div className="relative flex h-28 w-full items-end justify-center"><div className="w-full max-w-10 rounded-t-xl bg-gradient-to-t from-[#176254] to-[#7fc8b8] transition hover:from-[#123f4a]" style={{ height: `${Math.max(28, (reading.hr / chartMaximum) * 100)}%` }} /></div><span className="text-[11px] font-semibold text-slate-400">{index === 4 ? 'Now' : reading.timeLabel}</span></div>)}</div></div>
              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100"><div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_0.9fr] gap-4 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:grid"><span>Time</span><span>Heart rate</span><span>SpO₂</span><span>Skin temp.</span><span>Quality</span></div>{readings.slice(0, 4).map((reading) => <div className="grid grid-cols-2 gap-y-2 border-t border-slate-100 px-4 py-3.5 text-sm sm:grid-cols-[1.2fr_1fr_1fr_1fr_0.9fr] sm:gap-4" key={reading.id}><span className="font-semibold text-slate-700"><span className="text-xs font-normal text-slate-400 sm:hidden">Time · </span>{reading.timeLabel}</span><span className="text-slate-600"><span className="text-xs font-normal text-slate-400 sm:hidden">HR · </span>{reading.hr} bpm</span><span className="text-slate-600"><span className="text-xs font-normal text-slate-400 sm:hidden">SpO₂ · </span>{reading.spo2}%</span><span className="text-slate-600"><span className="text-xs font-normal text-slate-400 sm:hidden">Temp · </span>{reading.temp.toFixed(1)}°C</span><span className={`col-span-2 flex items-center gap-1.5 text-xs font-semibold sm:col-span-1 ${reading.signalOk ? 'text-emerald-600' : 'text-amber-600'}`}><span className={`h-1.5 w-1.5 rounded-full ${reading.signalOk ? 'bg-emerald-500' : 'bg-amber-500'}`} />{reading.signalOk ? 'Good signal' : 'Low quality'}</span></div>)}</div><p className="mt-4 text-xs leading-5 text-slate-400">Low-quality readings are stored for transparency and are excluded from this visual summary. No thresholds or alerts are applied.</p>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.04)] sm:p-7"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff4e5] text-[#b76a15]"><Icon name="note" className="h-4 w-4" /></span><h2 className="text-lg font-bold text-slate-900">Symptom journal</h2></div><p className="mt-2 text-sm text-slate-500">Record how you feel in your own words.</p></div><span className="hidden rounded-full bg-[#fff8ee] px-3 py-1.5 text-xs font-semibold text-[#b76a15] sm:block">Private to you</span></div><form onSubmit={handleSubmit} className="mt-6 grid gap-4 sm:grid-cols-[1fr_130px]"><label className="text-sm font-semibold text-slate-700">What are you noticing?<input value={symptom} onChange={(event) => setSymptom(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]" placeholder="e.g. fatigue, pain, headache" /></label><label className="text-sm font-semibold text-slate-700">Intensity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-normal text-slate-900 outline-none transition focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]"><option value="1">1 · Mild</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · Strong</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10">10 · Severe</option></select></label><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Notes <span className="font-normal text-slate-400">(optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#55a99a] focus:bg-white focus:ring-4 focus:ring-[#d9f0eb]" placeholder="Add context that may help you remember this later..." /></label><div className="flex flex-col items-start justify-between gap-3 sm:col-span-2 sm:flex-row sm:items-center"><p aria-live="polite" className="text-xs font-medium text-emerald-700">{formMessage}</p><button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#123f4a] px-5 text-sm font-bold text-white transition hover:bg-[#0b3038] focus:outline-none focus:ring-4 focus:ring-[#c9e3de]"><Icon name="plus" className="h-4 w-4" />Save symptom</button></div></form></section>
          </div>

          <aside className="space-y-6"><section className="overflow-hidden rounded-3xl bg-[#123f4a] p-6 text-white shadow-[0_18px_50px_rgba(18,63,74,0.2)]"><div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#a6ded3]"><Icon name="device" className="h-5 w-5" /></span><span className="flex items-center gap-2 rounded-full bg-[#a6ded3]/15 px-3 py-1.5 text-xs font-bold text-[#bde9e1]"><span className="h-1.5 w-1.5 rounded-full bg-[#7fdbc9]" />Connected</span></div><p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-[#8ab8b0]">Your wearable</p><h2 className="mt-2 text-xl font-bold">{deviceName}</h2><p className="mt-1 text-sm text-[#a5c7c2]">ESP32-WROOM-32D · Wi-Fi</p><div className="mt-7 flex items-center justify-between border-t border-white/10 pt-4 text-sm"><span className="text-[#a5c7c2]">Last data received</span><span className="font-semibold text-white">{lastSeen}</span></div><div className="mt-5 flex items-center gap-2 text-xs text-[#a5c7c2]"><Icon name="check" className="h-4 w-4 text-[#7fdbc9]" />Device status is informational only</div></section>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_45px_rgba(15,23,42,0.04)]"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-slate-900">Symptom history</h2><p className="mt-1 text-sm text-slate-500">Your latest check-ins</p></div><Icon name="note" className="h-5 w-5 text-slate-300" /></div><div className="mt-5 space-y-4">{symptoms.slice(0, 4).map((item) => <div className="flex gap-3" key={item.id}><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#e9a94f] ring-4 ring-[#fff4e5]" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-800">{item.symptom}</p><span className="shrink-0 text-xs font-semibold text-slate-400">{item.recordedAt}</span></div><p className="mt-1 text-xs text-slate-500">Intensity {item.severity}/10{item.notes ? ` · ${item.notes}` : ''}</p></div></div>)}</div>{symptoms.length === 0 && <p className="mt-5 text-sm text-slate-400">Your saved check-ins will appear here.</p>}</section>
            <section className="rounded-3xl border border-[#f0e4d3] bg-[#fffaf3] p-6"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#b76a15] shadow-sm"><Icon name="sparkle" className="h-4 w-4" /></span><div><h2 className="font-bold text-[#7e501b]">A useful record</h2><p className="mt-2 text-sm leading-6 text-[#9b7547]">Keeping symptoms alongside readings can help you describe your day more clearly during a conversation with your care team.</p></div></div></section></aside>
        </div>
        <footer className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>© 2026 SickleCare prototype · Built for patient-led tracking</span><span className="inline-flex items-center gap-1.5"><Icon name="shield" className="h-3.5 w-3.5" />Your readings are informational, not a diagnosis.</span></footer>
      </div>
    </main>
  );
}

function MetricCard({ label, value, unit, helper, tone, icon }: { label: string; value: string; unit: string; helper: string; tone: 'rose' | 'blue' | 'amber'; icon: 'heart' | 'signal' | 'thermometer' }) {
  const tones = { rose: 'bg-[#fff0f2] text-[#c35e6f]', blue: 'bg-[#eef5ff] text-[#4f78b8]', amber: 'bg-[#fff5e7] text-[#bd741d]' };
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.04)]"><div className="flex items-start justify-between"><p className="text-sm font-semibold text-slate-500">{label}</p><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><Icon name={icon} className="h-4 w-4" /></span></div><div className="mt-5 flex items-baseline gap-2"><span className="text-4xl font-bold tracking-[-0.05em] text-slate-900">{value}</span><span className="text-sm font-semibold text-slate-400">{unit}</span></div><p className="mt-2 text-xs text-slate-400">{helper}</p></article>;
}
