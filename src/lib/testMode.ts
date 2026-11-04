import { supabase } from "./supabaseClient";

/** The practice copy of a clinic uses the live slug plus "-test" (red-berry-test). */
export const TEST_SUFFIX = "-test";
export const isTestSlug = (slug: string | undefined | null) => !!slug && slug.endsWith(TEST_SUFFIX);
export const liveSlugOf = (slug: string) => (isTestSlug(slug) ? slug.slice(0, -TEST_SUFFIX.length) : slug);

const UPDATE_FILE = "clinicflow-update-5-2026-11-02.sql";

/**
 * Make (or, with reset, remake) the practice copy of a live clinic. Returns the practice slug,
 * or an error message. Reset throws the practice data away and starts again from the live
 * room names, staff and settings. It never touches the live clinic.
 */
export async function ensureTestClinic(
  liveSlug: string,
  reset: boolean
): Promise<{ slug: string | null; error: string | null }> {
  const { data: live, error: liveErr } = await supabase.from("clinics").select("id").eq("slug", liveSlug).single();
  if (liveErr || !live) return { slug: null, error: "Could not find the live clinic." };
  const { data, error } = await supabase.rpc("ensure_test_clinic", { p_live_clinic_id: live.id, p_reset: reset });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883" || /ensure_test_clinic|schema cache/i.test(error.message);
    return {
      slug: null,
      error: missing
        ? `Test mode needs the database update. Run ${UPDATE_FILE} in the Supabase SQL Editor, then try again.`
        : `Test mode failed: ${error.message}`
    };
  }
  return data ? { slug: data as string, error: null } : { slug: null, error: "Test mode could not be started." };
}
