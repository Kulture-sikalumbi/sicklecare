import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import RedeemShareForm from './redeem-share-form';
import RefreshDashboard from './refresh-dashboard';

export const instant = false;

type Reading = {
  id: string;
  user_id: string;
  recorded_at: string;
  hr_bpm: number;
  spo2_pct: number;
  skin_temp_c: number | null;
  signal_ok: boolean;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default async function DoctorPage() {
  const isSupabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!isSupabaseConfigured) {
    return <AccessMessage title="Clinician portal needs Supabase" message="Connect the SickleCare Supabase project and apply the clinician sharing migration to enable patient sharing." />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return <AccessMessage title="Sign in to continue" message="Use your SickleCare account to open the clinician portal." action="Sign in" />;
  }

  const { data: clinician } = await supabase
    .from('clinicians')
    .select('display_name')
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (!clinician) {
    return <AccessMessage title="Clinician access is not enabled" message="Clinician accounts are provisioned by a SickleCare administrator. After your account is enabled, you can connect to patients who share a code with you." />;
  }

  const { data: sharedProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .neq('id', authData.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  const patientProfiles = sharedProfiles ?? [];
  const patientIds = patientProfiles.map((profile) => profile.id);

  let patients: { id: string; name: string; reading: Reading | null }[] = [];
  if (patientIds.length) {
    const { data: readingData } = await supabase.from('readings')
      .select('id, user_id, recorded_at, hr_bpm, spo2_pct, skin_temp_c, signal_ok')
      .in('user_id', patientIds)
      .order('recorded_at', { ascending: false })
      .limit(Math.min(patientIds.length * 20, 1000));
    const latestByPatient = new Map<string, Reading>();
    for (const row of (readingData ?? []) as Reading[]) {
      if (!latestByPatient.has(row.user_id)) latestByPatient.set(row.user_id, row);
    }
    patients = patientProfiles.map((profile) => ({
      id: profile.id,
      name: profile.full_name?.trim() || profile.email || 'Shared patient',
      reading: latestByPatient.get(profile.id) ?? null,
    }));
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#123f4a] text-lg text-white">♥</span><span><span className="block text-[15px] font-bold text-[#123f4a]">SickleCare</span><span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Clinician portal</span></span></Link>
          <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-slate-900">Patient dashboard</Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#176254]">{clinician.display_name || 'Care team'}</p><h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Shared patient readings</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Review recent wearable readings for patients who opted into automatic sharing or shared a code with you.</p></div>
          <RefreshDashboard />
        </section>

        <section className="mb-7 rounded-3xl border border-[#c9e3de] bg-[#eaf7f4] p-5 sm:p-6">
          <h2 className="font-semibold text-[#123f4a]">Informational readings</h2>
          <p className="mt-1 text-sm leading-6 text-[#3c7069]">Readings are sensor estimates and are not clinically validated. This portal does not diagnose, apply alert thresholds, or provide emergency monitoring. Contact patients through your usual care process when follow-up is needed.</p>
        </section>

        <div className="mb-7"><RedeemShareForm /></div>

        {patients.length === 0 ? <section className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-[0_12px_45px_rgba(15,23,42,0.04)]"><h2 className="text-lg font-bold text-slate-900">No patients connected yet</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">A patient can enable automatic vitals sharing in their dashboard, or send you a one-time code.</p></section> : <section className="grid gap-4 lg:grid-cols-2">
          {patients.map((patient) => <article key={patient.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.04)] sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">{patient.name}</h2><p className="mt-1 text-xs text-slate-400">Connected patient</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${patient.reading?.signal_ok ? 'bg-emerald-50 text-emerald-700' : patient.reading ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{patient.reading ? patient.reading.signal_ok ? 'Signal marked good' : 'Low signal quality' : 'Awaiting readings'}</span></div>
            {patient.reading ? <>
              <p className="mt-5 text-xs font-medium text-slate-400">Latest reading · {formatDate(patient.reading.recorded_at)}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Metric label="Heart rate" value={`${patient.reading.hr_bpm}`} unit="bpm" />
                <Metric label="SpO₂ estimate" value={`${patient.reading.spo2_pct}`} unit="%" />
                <Metric label="Skin temperature" value={patient.reading.skin_temp_c === null ? '—' : patient.reading.skin_temp_c.toFixed(1)} unit={patient.reading.skin_temp_c === null ? "" : "°C"} />
              </div>
            </> : <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">This patient has not shared a wearable reading yet.</p>}
          </article>)}
        </section>}
        <footer className="mt-10 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-400">Patients can turn off automatic sharing or revoke an individual clinician connection at any time.</footer>
      </div>
    </main>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="rounded-2xl bg-[#f8fafc] p-3"><p className="min-h-8 text-[11px] font-semibold leading-4 text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold tracking-[-0.04em] text-slate-900">{value}<span className="ml-1 text-xs font-semibold text-slate-400">{unit}</span></p></div>;
}

function AccessMessage({ title, message, action }: { title: string; message: string; action?: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-5 py-10"><section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_20px_70px_rgba(15,23,42,0.08)]"><Link href="/" className="text-sm font-bold text-[#176254]">SickleCare</Link><h1 className="mt-5 text-2xl font-bold tracking-[-0.04em] text-slate-950">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{message}</p>{action && <Link href="/login?next=%2Fdoctor" className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#123f4a] px-5 text-sm font-bold text-white">{action}</Link>}<p className="mt-6 text-xs leading-5 text-slate-400">Clinician accounts must be provisioned by a SickleCare administrator.</p></section></main>;
}
